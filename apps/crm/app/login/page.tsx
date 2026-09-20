"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useNavigationFeedback } from "@/components/ui/navigation-feedback";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;
const SHOW_DEV_HINT = process.env.NODE_ENV !== "production";

export default function LoginPage() {
  const router = useRouter();
  const { beginNavigation } = useNavigationFeedback();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [loading, setLoading] = useState(false);

  function fail(msg: string) {
    setError(msg);
    setShake((n) => n + 1);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      fail("Enter your staff email and password to continue.");
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<{ token: string; role: string }>("/admin/login", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ email: email.trim(), password }),
      });
      setToken(data.token);
      beginNavigation("/");
      router.push("/");
    } catch (err) {
      fail(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={FONT}
      className="grid min-h-dvh grid-cols-1 bg-white lg:h-dvh lg:grid-cols-2"
    >
      <style>{`@keyframes login-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-6px); } 50% { transform: translateX(6px); } 75% { transform: translateX(-3px); } }`}</style>

      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#14231a] p-10 text-white lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#c2410c] text-base font-bold">
            CW
          </span>
          <span className="leading-tight">
            <span className="block text-lg font-semibold">CityWatch</span>
            <span className="block text-[11px] tracking-[0.2em] text-zinc-400">OPS · V1</span>
          </span>
        </div>
        <div className="relative space-y-3">
          <p className="text-2xl font-bold leading-snug">
            Every report,
            <br />
            reviewed in one place.
          </p>
          <p className="max-w-sm text-sm leading-relaxed text-zinc-400">
            The ops console for triaging citizen incidents — verify reports, coordinate response,
            and keep the city moving.
          </p>
          <div className="flex gap-2 pt-2">
            {["Triage", "Verify", "Respond"].map((s) => (
              <span
                key={s}
                className="rounded-full border border-white/15 px-3 py-1 text-xs text-zinc-300"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-zinc-500">Staff access only · All actions are audited</p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-[#faf7f0] p-6 sm:p-10 lg:overflow-y-auto">
        <Card className="w-full max-w-md p-6 sm:p-8">
          <div className="mb-1 flex items-center gap-2 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#c2410c] text-xs font-bold text-white">
              CW
            </span>
            <span className="text-sm font-semibold">CityWatch</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-zinc-900">Welcome back</h1>
          <p className="mt-1 text-sm text-zinc-500">Ops console access</p>

          <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
            <div>
              <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-zinc-700">
                Staff email
              </label>
              <Input
                id="login-email"
                type="email"
                autoComplete="username"
                placeholder="you@citywatch.ops"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!error}
                className="focus:border-[#2a4a33] focus:ring-2 focus:ring-[#2a4a33]/25"
              />
            </div>
            <div>
              <label
                htmlFor="login-password"
                className="mb-1.5 block text-sm font-medium text-zinc-700"
              >
                Password
              </label>
              <div className="relative">
                <Input
                  id="login-password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={(e) => setCapsOn(!!e.getModifierState?.("CapsLock"))}
                  onKeyDown={(e) => setCapsOn(!!e.getModifierState?.("CapsLock"))}
                  onBlur={() => setCapsOn(false)}
                  aria-invalid={!!error}
                  aria-describedby={capsOn ? "caps-hint" : undefined}
                  className="pr-16 focus:border-[#2a4a33] focus:ring-2 focus:ring-[#2a4a33]/25"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-pressed={showPw}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
              {capsOn && (
                <p id="caps-hint" className="mt-1.5 text-xs text-amber-700">
                  Caps Lock is on — passwords are case-sensitive.
                </p>
              )}
            </div>

            {error && (
              <div
                key={shake}
                role="alert"
                style={{ animation: "login-shake 0.3s ease" }}
                className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden>
                  <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M10 6v4.5M10 13.5v.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-[#14231a] py-2.5 hover:bg-[#2a4a33] disabled:opacity-70"
            >
              {loading && (
                <svg viewBox="0 0 20 20" fill="none" className="mr-2 h-4 w-4 animate-spin" aria-hidden>
                  <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                  <path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
              {loading ? "Signing in…" : "Sign in"}
            </Button>

            {SHOW_DEV_HINT && (
              <p className="rounded-md bg-zinc-100 px-3 py-2 text-center text-xs text-zinc-500">
                Dev account: <span className="font-mono">admin@example.com / admin123</span>
              </p>
            )}
          </form>
        </Card>
      </div>
    </div>
  );
}
