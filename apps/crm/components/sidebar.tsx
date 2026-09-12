"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
  staff: "M4 5.5h12M4 10h12M4 14.5h7M16 15.5l2 2 3.5-4",
  analytics: "M3.5 17V10M8 17V4.5M12.5 17v-6M17 17V7.5",
};

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/incidents": "Incidents",
  "/users": "Users",
  "/staff": "Staff",
  "/analytics": "Insights",
};

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [userMenu, setUserMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Collapse preference persists across reloads. Read post-mount so the
  // first render matches SSR and never hydrates differently.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem("cw-sidebar-collapsed") === "1");
    } catch {
      /* private mode — stay expanded */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem("cw-sidebar-collapsed", c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  // All hooks run unconditionally — the /login early return happens below,
  // after every hook, so hook order never changes between renders.
  const { data: queue } = useQuery({
    queryKey: ["sidebar-needs-review"],
    queryFn: () =>
      apiFetch<{ total: number }>(`/admin/incidents?status=needs_review`),
    enabled: pathname !== "/login",
    refetchInterval: 60000,
    retry: false,
  });

  useEffect(() => {
    setMounted(true);
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setUserMenu(false);
  }, [pathname]);

  useEffect(() => {
    if (!userMenu) return;
    const close = () => setUserMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [userMenu]);

  if (pathname === "/login") return <>{children}</>;

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
          badge: queue?.total,
          icon: <Icon d={ICONS.incidents} />,
        },
      ],
    },
    {
      label: "Manage",
      items: [
        { href: "/users", label: "Users", icon: <Icon d={ICONS.users} /> },
        { href: "/staff", label: "Staff", icon: <Icon d={ICONS.staff} /> },
      ],
    },
    {
      label: "Insights",
      items: [{ href: "/analytics", label: "Insights", icon: <Icon d={ICONS.analytics} /> }],
    },
  ];

  const title =
    TITLES[pathname] ??
    (pathname.startsWith("/incidents/")
      ? "Incident detail"
      : pathname.startsWith("/analytics/")
        ? "Evidence detail"
        : "CityWatch");

  const token = typeof window !== "undefined" ? getToken() : null;
  let initial = "OP";
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1] ?? "")) as Record<string, unknown>;
      const raw =
        typeof payload.email === "string"
          ? payload.email
          : typeof payload.sub === "string"
            ? payload.sub
            : "";
      if (raw) initial = raw.slice(0, 2).toUpperCase();
    } catch {
      /* keep OP fallback */
    }
  }
  const clock = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const signOut = () => {
    clearToken();
    router.push("/login");
  };

  return (
    <div className="flex min-h-screen">
      <aside
        className={`sticky top-0 flex h-screen shrink-0 flex-col bg-[#14231a] text-zinc-300 transition-[width] ${
          collapsed ? "w-16" : "w-60"
        } max-sm:w-16 max-sm:overflow-hidden`}
      >
        <div className={`relative flex shrink-0 items-center gap-2.5 px-5 pb-5 pt-6 max-sm:justify-center max-sm:gap-0 max-sm:px-0 ${collapsed ? "flex-col gap-1 px-0" : ""}`}>
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#c2410c] text-sm font-bold text-white max-sm:hidden"
            title="CityWatch ops console"
          >
            CW
          </span>
          {!collapsed && (
            <span className="leading-tight max-sm:hidden">
              <span className="block text-sm font-semibold text-white">CityWatch</span>
              <span className="block text-[10px] tracking-widest text-zinc-500">OPS · V1</span>
            </span>
          )}
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white ${collapsed ? "" : "ml-auto"} max-sm:absolute max-sm:right-0 max-sm:ml-0`}
          >
            <Icon d={collapsed ? "M7 4l6 6-6 6M13 4l6 6-6 6" : "M13 4L7 10l6 6M7 4L1 10l6 6"} />
          </button>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {sections.map((s) => (
            <div key={s.label}>
              {!collapsed && (
                <p className="px-3 pb-1.5 text-[10px] font-semibold tracking-widest text-zinc-500 max-sm:hidden">
                  {s.label.toUpperCase()}
                </p>
              )}
              <ul className="space-y-0.5">
                {s.items.map((it) => {
                  const active =
                    it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
                  return (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        title={it.label}
                        aria-current={active ? "page" : undefined}
                        className={`flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                          active
                            ? "bg-[#2a4a33] font-medium text-white shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_0_12px_rgba(42,74,51,0.9)]"
                            : "text-zinc-400 hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        {it.icon}
                        {!collapsed && <span className="flex-1 max-sm:hidden">{it.label}</span>}
                        {!collapsed && !!it.badge && (
                          <span className="relative flex rounded-full bg-[#c2410c] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white max-sm:hidden">
                            {it.badge > 0 && (
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#c2410c] opacity-60" />
                            )}
                            <span className="relative">{it.badge}</span>
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
        <div className="shrink-0 p-3">
          <button
            onClick={signOut}
            title="Sign out of the ops console"
            className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-white"
          >
            <Icon d="M7 3.5H4.5v13H7M13 6.5L16.5 10 13 13.5M16.5 10H8" />
            {!collapsed && <span className="max-sm:hidden">Sign out</span>}
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-w-0 items-center gap-3 overflow-hidden border-b border-[#e8e0d0] bg-[#faf7f0] px-4 py-4 sm:px-8">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 truncate text-xl">
            <span className="font-medium text-zinc-400">CityWatch</span>
            <span aria-hidden className="text-zinc-300">/</span>
            <h1 className="truncate font-bold text-zinc-900">{title}</h1>
          </nav>
          <span
            className="hidden rounded-full bg-[#14231a] px-2 py-0.5 text-[10px] font-semibold tracking-widest text-zinc-300 sm:inline-flex"
            title="Operations console v1"
          >
            OPS · V1
          </span>
          <span className="hidden w-12 text-xs tabular-nums text-zinc-500 sm:block" title="Local time">
            {mounted ? clock : ""}
          </span>
          <div className="relative ml-auto">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setUserMenu((v) => !v);
              }}
              aria-haspopup="menu"
              aria-expanded={userMenu}
              title="Staff account — ops console"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2a4a33] text-xs font-bold text-white hover:ring-2 hover:ring-[#2a4a33]/40"
            >
              {mounted ? initial : "OP"}
            </button>
            {userMenu && (
              <div
                role="menu"
                className="absolute right-0 z-40 mt-2 w-44 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg"
              >
                <p className="px-3 py-1.5 text-xs text-zinc-500">Staff · Ops console</p>
                <button
                  role="menuitem"
                  onClick={signOut}
                  className="block w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="flex-1 bg-[#faf7f0] px-4 py-6 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
