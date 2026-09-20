"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;

export default function InviteActivationPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => setToken(new URLSearchParams(window.location.search).get("token") ?? ""), []);
  async function activate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!token) return setError("This invitation link is missing its token.");
    if (password.length < 8) return setError("Use at least 8 characters for your password.");
    if (password !== confirmation) return setError("The passwords do not match.");
    try { await apiFetch("/admin/staff/invitations/accept", { method: "POST", auth: false, body: JSON.stringify({ token, password }) }); setDone(true); } catch (err) { setError(err instanceof Error ? err.message : "Activation failed"); }
  }
  return <div className="flex min-h-dvh items-center justify-center bg-[#faf7f0] p-6" style={FONT}><Card className="w-full max-w-md p-6 sm:p-8"><div className="mb-6"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#285e4a]">CityWatch ops</p><h1 className="mt-2 text-2xl font-bold text-zinc-900">Activate your staff account</h1><p className="mt-2 text-sm leading-6 text-zinc-600">Choose a password to finish accepting this invitation.</p></div>{done ? <div className="space-y-4"><p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">Your account is ready. Sign in to open the operations console.</p><Button type="button" onClick={() => router.push("/login")} className="w-full bg-[#14231a] hover:bg-[#2a4a33]">Go to sign in</Button></div> : <form className="space-y-4" onSubmit={activate}><div><label htmlFor="invite-password" className="mb-1 block text-sm font-semibold text-zinc-800">Password</label><Input id="invite-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></div><div><label htmlFor="invite-password-confirm" className="mb-1 block text-sm font-semibold text-zinc-800">Confirm password</label><Input id="invite-password-confirm" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div>{error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}<Button type="submit" disabled={!password || !confirmation} className="w-full bg-[#14231a] hover:bg-[#2a4a33]">Activate account</Button></form>}</Card></div>;
}
