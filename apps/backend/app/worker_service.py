"""HTTP wrapper for running the Celery worker on a Render web service.

Render web services must listen on an HTTP port. This small process owns the
Celery child process and exposes a health check without putting AI work back
onto the public API service.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException


def _celery_command() -> list[str]:
    command = [
        sys.executable,
        "-m",
        "celery",
        "-A",
        "app.worker.celery",
        "worker",
        "--loglevel=info",
        "--concurrency",
        os.getenv("CELERY_WORKER_CONCURRENCY", "1"),
    ]
    if os.name == "nt":
        command.extend(["--pool=solo"])
    return command


def _stop_worker(worker: subprocess.Popen[object]) -> None:
    if worker.poll() is not None:
        return
    worker.send_signal(signal.SIGTERM)
    try:
        worker.wait(timeout=15)
    except subprocess.TimeoutExpired:
        worker.kill()
        worker.wait()


@asynccontextmanager
async def lifespan(app: FastAPI):
    worker = subprocess.Popen(_celery_command())
    app.state.celery_worker = worker
    try:
        yield
    finally:
        _stop_worker(worker)


app = FastAPI(title="CityWatch analysis worker", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, bool]:
    worker: subprocess.Popen[object] | None = getattr(app.state, "celery_worker", None)
    if worker is None or worker.poll() is not None:
        raise HTTPException(status_code=503, detail="Celery worker is unavailable")
    return {"ok": True}
