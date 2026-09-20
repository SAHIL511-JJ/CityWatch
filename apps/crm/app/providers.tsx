"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        retryDelay: (attempt) => Math.min(300, Math.max(100, attempt * 300)),
      },
    },
  }));
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
