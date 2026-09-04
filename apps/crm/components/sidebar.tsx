"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, clearToken, getToken } from "@/lib/api";

type Item = { href: string; label: string; badge?: number; icon: React.ReactNode };

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS: Record<string, string> = {
  dashboard: "M3 3h4.5v4.5H3zM12.5 3H17v4.5h-4.5zM3 12.5h4.5V17H3zM12.5 12.5H17V17h-4.5z",
  incidents: "M10 3v4M10 11v6M4 6.5h12M6 17.5h8",
  users: "M13.5 13.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 17a5.5 5.5 0 0 1 9-4.2M3.5 17h13",
  analytics: "M3.5 17V10M8 17V4.5M12.5 17v-6M17 17V7.5",
};

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/incidents": "Incidents",
  "/users": "Users",
  "/analytics": "Analytics",
};

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname === "/login") return <>{children}</>;

  const loggedIn = typeof window !== "undefined" && !!getToken();
  const { data: queue } = useQuery({
    queryKey: ["sidebar-needs-review"],
    queryFn: () =>
      apiFetch<unknown[]>(`/admin/incidents?status=needs_review`),
    enabled: loggedIn,
    refetchInterval: 60000,
    retry: false,
  });

  const sections: { label: string; items: Item[] }[] = [
    {
      label: "Overview",
      items: [{ href: "/", label: "Dashboard", icon: <Icon d={ICONS.dashboard} /> }],
    },
    {
      label: "Review",
      items: [
        {
          href: "/incidents",
          label: "Incidents",
          badge: queue?.length,
          icon: <Icon d={ICONS.incidents} />,
        },
      ],
    },
    {
      label: "Manage",
      items: [{ href: "/users", label: "Users", icon: <Icon d={ICONS.users} /> }],
    },
    {
      label: "Insights",
      items: [{ href: "/analytics", label: "Analytics", icon: <Icon d={ICONS.analytics} /> }],
    },
  ];

  const title =
    TITLES[pathname] ??
    (pathname.startsWith("/incidents/") ? "Incident detail" : "CityWatch");

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-[#14231a] text-zinc-300">
        <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#c2410c] text-sm font-bold text-white">
            CW
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold text-white">CityWatch</span>
            <span className="block text-[10px] tracking-widest text-zinc-500">OPS · V1</span>
          </span>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {sections.map((s) => (
            <div key={s.label}>
              <p className="px-3 pb-1.5 text-[10px] font-semibold tracking-widest text-zinc-500">
                {s.label.toUpperCase()}
              </p>
              <ul className="space-y-0.5">
                {s.items.map((it) => {
                  const active =
                    it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
                  return (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                          active
                            ? "bg-[#2a4a33] font-medium text-white"
                            : "text-zinc-400 hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        {it.icon}
                        <span className="flex-1">{it.label}</span>
                        {!!it.badge && (
                          <span className="rounded-full bg-[#c2410c] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                            {it.badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="p-3">
          <button
            onClick={() => {
              clearToken();
              router.push("/login");
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-white"
          >
            <Icon d="M7 3.5H4.5v13H7M13 6.5L16.5 10 13 13.5M16.5 10H8" />
            Sign out
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center border-b border-[#e8e0d0] bg-[#faf7f0] px-8 py-4">
          <h1 className="text-xl font-bold text-zinc-900">{title}</h1>
          <span className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-[#2a4a33] text-xs font-bold text-white">
            OP
          </span>
        </header>
        <main className="flex-1 bg-[#faf7f0] px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
