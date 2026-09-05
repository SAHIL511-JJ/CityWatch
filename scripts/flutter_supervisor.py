"""One persistent supervisor owning `flutter run -d chrome --machine`.

Why: sandbox shells can't press `r` (no tmux/screen, Windows .bat breaks
pipes). The supervisor holds the single long-lived flutter process and
exposes tiny local HTTP endpoints for one-shot calls:

  GET  /status   -> {"running": bool, "appId": str|None,
                     "vmServiceUri": str|None, "lastReload": {...}|None}
  POST /reload   -> hot reload, waits for the correlated result
  POST /restart  -> full restart, waits for app.started
  GET  /logs?n=80 -> tail of flutter tool output

Usage:
  python flutter_supervisor.py serve   # foreground (run under nohup &)
  curl -s -X POST localhost:8123/reload
"""

import json
import os
import queue
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.abspath(os.path.join(HERE, "..", "apps", "mobile"))
PORT = 8123
STATE_FILE = os.path.join(APP_DIR, "logs", ".supervisor_state.json")
MAX_LOG = 400


class Supervisor:
    def __init__(self):
        self.proc = None
        self.app_id = None
        self.vm_uri = None
        self.lines = []
        self.pending = {}
        self.cmd_id = 0
        self.lock = threading.Lock()
        self.last_reload = None
        self.running = False
        self._reader = None

    def log(self, line):
        self.lines.append(line)
        del self.lines[: -MAX_LOG if len(self.lines) > MAX_LOG else 0]

    def start_flutter(self):
        env = dict(os.environ)
        env["PYTHONUTF8"] = "1"
        # Bypass flutter.bat: batch files swallow piped stdin on Windows.
        # Invoke the tool snapshot directly with dart.exe (a real exe,
        # so stdin pipes work). shell=False.
        root = env.get("FLUTTER_ROOT", r"C:\Users\sahil\flutter")
        env["FLUTTER_ROOT"] = root
        dart = os.path.join(root, "bin", "cache", "dart-sdk", "bin", "dart.exe")
        snap = os.path.join(root, "bin", "cache", "flutter_tools.snapshot")
        pkg = os.path.join(
            root, "packages", "flutter_tools", ".dart_tool", "package_config.json"
        )
        argv = [
            dart,
            f"--packages={pkg}",
            snap,
            "run",
            "-d",
            "chrome",
            "--machine",
            "--web-port",
            "8080",
            "--dart-define=API_URL=http://127.0.0.1:8000",
        ]
        env["PATH"] = os.path.join(root, "bin") + os.pathsep + env.get("PATH", "")
        self.proc = subprocess.Popen(
            argv,
            cwd=APP_DIR,
            shell=False,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=env,
        )
        self.running = True
        self._reader = threading.Thread(target=self._drain, daemon=True)
        self._reader.start()

    def _drain(self):
        # Separate thread: stdout pipe is 64KB, blocks the child if unread.
        out = self.proc.stdout if self.proc else None
        assert out is not None
        for raw in out:
            line = raw.strip()
            if not line:
                continue
            self.log(line)
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            # --machine wraps every message in a single-element list.
            if isinstance(msg, list) and len(msg) == 1:
                msg = msg[0]
            if isinstance(msg, dict) and "event" in msg:
                self._on_event(msg)
            elif isinstance(msg, dict) and "id" in msg:
                with self.lock:
                    q = self.pending.pop(msg["id"], None)
                if q is not None:
                    q.put(msg)

    def _on_event(self, msg):
        event, params = msg.get("event"), msg.get("params") or {}
        if event == "app.started":
            self.app_id = params.get("appId")
            self._save_state()
        elif event == "app.debugPort":
            self.vm_uri = params.get("wsUri") or params.get("vmServiceUri")
            self._save_state()

    def _save_state(self):
        try:
            os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
            with open(STATE_FILE, "w") as f:
                json.dump({"appId": self.app_id, "vmServiceUri": self.vm_uri}, f)
        except OSError:
            pass

    def _send(self, method, params, timeout=180):
        with self.lock:
            self.cmd_id += 1
            cid = self.cmd_id
            q = queue.Queue()
            self.pending[cid] = q
        # Daemon wire framing: the parser scans raw bytes for \n, then
        # requires the trimmed line to start with '[{' and end with '}]'
        # (brackets are stripped, only the inner object is JSON-decoded).
        # Bare {...} is silently discarded — no error, ever.
        payload = (
            "["
            + json.dumps(
                {"id": cid, "method": method, "params": params}, separators=(",", ":")
            )
            + "]\n"
        )
        proc = self.proc
        assert proc is not None and proc.stdin is not None
        proc.stdin.write(payload)
        proc.stdin.flush()
        try:
            return q.get(timeout=timeout)
        except queue.Empty:
            with self.lock:
                self.pending.pop(cid, None)
            return {"id": cid, "error": "timeout waiting for flutter"}

    def reload(self):
        if not self.running or not self.app_id:
            return {"ok": False, "error": "flutter not ready (no appId yet)"}
        res = self._send(
            "app.restart",
            {
                "appId": self.app_id,
                "fullRestart": False,
                "pause": False,
            },
        )
        ok = "error" not in res
        self.last_reload = {
            "ok": ok,
            "at": time.strftime("%H:%M:%S"),
            "detail": res.get("result", res.get("error")),
        }
        return {"ok": ok, "result": self.last_reload}

    def restart(self):
        self.stop_flutter()
        time.sleep(3)
        self.app_id = None
        self.vm_uri = None
        self.start_flutter()
        deadline = time.time() + 180
        while time.time() < deadline:
            if self.app_id:
                return {"ok": True, "appId": self.app_id}
            time.sleep(2)
        return {"ok": False, "error": "app.started never arrived"}

    def stop_flutter(self):
        self.running = False
        if self.proc and self.proc.poll() is None:
            subprocess.run(
                ["taskkill", "/PID", str(self.proc.pid), "/T", "/F"],
                capture_output=True,
            )
            self.proc = None


SUP = Supervisor()


class Handler(BaseHTTPRequestHandler):
    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/status":
            self._json(
                {
                    "running": SUP.running
                    and SUP.proc is not None
                    and SUP.proc.poll() is None,
                    "appId": SUP.app_id,
                    "vmServiceUri": SUP.vm_uri,
                    "lastReload": SUP.last_reload,
                }
            )
        elif self.path.startswith("/logs"):
            try:
                n = int(self.path.split("n=")[1].split("&")[0])
            except (IndexError, ValueError):
                n = 80
            self._json({"lines": SUP.lines[-n:]})
        else:
            self._json({"error": "unknown endpoint"}, 404)

    def do_POST(self):
        if self.path == "/reload":
            self._json(SUP.reload())
        elif self.path == "/restart":
            self._json(SUP.restart())
        elif self.path == "/send":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            res = SUP._send(body.get("method", ""), body.get("params", {}), timeout=60)
            self._json({"response": res})
        else:
            self._json({"error": "unknown endpoint"}, 404)

    def log_message(self, format, *args):
        pass


def main():
    SUP.start_flutter()
    httpd = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"supervisor on :{PORT}, flutter booting...", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
