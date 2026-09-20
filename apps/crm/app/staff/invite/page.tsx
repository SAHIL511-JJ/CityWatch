"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { NavigationLink } from "@/components/ui/navigation-link";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;

export default function StaffInvitePage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("dispatcher");
  const [message, setMessage] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: () => apiFetch<{ email: string; role: string }>("/admin/staff/invitations", { method: "POST", body: JSON.stringify({ email: email.trim(), role }) }),
    onSuccess: (result) => { setMessage(`Invitation sent to ${result.email}. The link expires in 72 hours.`); setEmail(""); },
  });

  return <div className="mx-auto max-w-[900px] space-y-6 pb-10" style={FONT}><PageHeader eyebrow="Manage operations" title="Invite staff" description="Send a secure, one-time setup link to a new CityWatch operator." meta={<NavigationLink href="/staff" className="text-sm font-semibold text-[#285e4a] hover:underline">Back to Staff</NavigationLink>} /><Card className="max-w-xl space-y-5"><div><label htmlFor="invite-email" className="mb-1 block text-sm font-semibold text-zinc-800">Staff email</label><Input id="invite-email" type="email" autoComplete="email" placeholder="operator@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></div><div><label htmlFor="invite-role" className="mb-1 block text-sm font-semibold text-zinc-800">Role</label><select id="invite-role" value={role} onChange={(event) => setRole(event.target.value)} className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm capitalize outline-none focus:border-[#2a4a33] focus:ring-2 focus:ring-[#dce8dc]"><option value="dispatcher">Dispatcher</option><option value="analyst">Analyst</option><option value="admin">Admin</option></select></div><p className="text-xs leading-5 text-zinc-500">The recipient chooses their own password from a single-use link. Resend must be configured before an invitation can be sent.</p>{message && <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}{invite.error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">Invitation failed: {(invite.error as Error).message}</p>}<div className="flex flex-wrap gap-2"><Button type="button" disabled={!email.trim() || invite.isPending} onClick={() => invite.mutate()} className="bg-[#14231a] hover:bg-[#2a4a33]">{invite.isPending ? "Sending…" : "Send invitation"}</Button><Button type="button" onClick={() => router.push("/staff")} className="bg-white text-zinc-700 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-100">Cancel</Button></div></Card></div>;
}
