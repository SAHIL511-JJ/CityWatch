import type { Metadata } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Incident CRM",
  description: "Ops CRM for incident review",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <nav className="border-b bg-white">
            <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 text-sm">
              <a href="/" className="font-semibold">Incident CRM</a>
              <a href="/incidents" className="text-zinc-600 hover:text-black">Incidents</a>
              <a href="/users" className="text-zinc-600 hover:text-black">Users</a>
              <a href="/analytics" className="text-zinc-600 hover:text-black">Analytics</a>
              <a href="/login" className="ml-auto text-zinc-600 hover:text-black">Login</a>
            </div>
          </nav>
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
