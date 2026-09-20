"use client";

import { usePathname } from "next/navigation";
import * as React from "react";

type NavigationFeedbackValue = {
  pendingPath: string | null;
  beginNavigation: (href: string) => void;
  isTargetPending: (href: string) => boolean;
};

const NavigationFeedbackContext = React.createContext<NavigationFeedbackValue | null>(null);

function routeLabel(path: string): string {
  if (path === "/") return "Dashboard";
  if (path === "/incidents") return "Incidents";
  if (path.startsWith("/incidents/")) return "Incident detail";
  if (path === "/users") return "Users";
  if (path === "/staff") return "Staff";
  if (path === "/analytics") return "Insights";
  if (path.startsWith("/analytics/")) return "Evidence detail";
  if (path === "/login") return "Sign in";
  return "the next page";
}

export function normalizeInternalPath(href: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const target = new URL(href, window.location.href);
    if (target.origin !== window.location.origin || target.hash) return null;
    return target.pathname;
  } catch {
    return null;
  }
}

export function NavigationFeedbackProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pendingPath, setPendingPath] = React.useState<string | null>(null);
  const sequence = React.useRef(0);
  const timeout = React.useRef<number | null>(null);

  const clearPending = React.useCallback((expectedSequence?: number) => {
    if (expectedSequence !== undefined && expectedSequence !== sequence.current) return;
    if (timeout.current) {
      window.clearTimeout(timeout.current);
      timeout.current = null;
    }
    setPendingPath(null);
  }, []);

  const beginNavigation = React.useCallback((href: string) => {
    const nextPath = normalizeInternalPath(href);
    if (!nextPath || nextPath === window.location.pathname) return;
    sequence.current += 1;
    const currentSequence = sequence.current;
    if (timeout.current) window.clearTimeout(timeout.current);
    setPendingPath(nextPath);
    timeout.current = window.setTimeout(() => clearPending(currentSequence), 10000);
  }, [clearPending]);

  React.useEffect(() => {
    if (pendingPath && pathname === pendingPath) clearPending();
  }, [clearPending, pathname, pendingPath]);

  React.useEffect(() => () => {
    if (timeout.current) window.clearTimeout(timeout.current);
  }, []);

  const value = React.useMemo<NavigationFeedbackValue>(() => ({
    pendingPath,
    beginNavigation,
    isTargetPending: (href: string) => {
      const target = normalizeInternalPath(href);
      return !!target && target === pendingPath;
    },
  }), [beginNavigation, pendingPath]);

  return (
    <NavigationFeedbackContext.Provider value={value}>
      {pendingPath && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center" role="status" aria-live="polite">
          <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#14231a] px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
            <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none" />
            Opening {routeLabel(pendingPath)}…
          </div>
          <span className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-[#dce8dc]">
            <span aria-hidden className="block h-full w-1/3 animate-[navigation-progress_1.2s_ease-in-out_infinite] bg-[#2a4a33] motion-reduce:animate-none" />
          </span>
        </div>
      )}
      {children}
    </NavigationFeedbackContext.Provider>
  );
}

export function useNavigationFeedback(): NavigationFeedbackValue {
  const context = React.useContext(NavigationFeedbackContext);
  if (!context) throw new Error("useNavigationFeedback must be used inside NavigationFeedbackProvider");
  return context;
}
