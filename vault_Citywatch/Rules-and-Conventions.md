# Rules-and-Conventions

Binding rules — every note below assumes these. Break one and something silently stops working.

## Data, auth, photos

- Supabase is for **data + photos only** ([[Database]]). No Auth, Functions, Realtime, RLS, Vault.
- Auth is **custom JWT** ([[Backend]]): anonymous `device_id` + OTP stub, `verified` flag, trust scores.
- Photos flow **App → [[Backend]] → Storage**. No direct app-to-storage or [[Frontend-CRM]]-to-Supabase uploads.
- **No direct app/CRM-to-Supabase traffic at all** — only the [[Backend]] holds the service key.
- **No direct DB writes for data** — everything goes through the API; raw SQL is for **migrations only** (`supabase/migrations/`).

## Secrets, git, worktrees

- `.env` files are **never committed**. Gitignored: `.env`, `.env.*` (except `.env.example`), `*.pem`, `*.key`, plus `dev.db`, `uploads/`, `node_modules/`, `.next/`, `*.log`, `.playwright-mcp/`, `*.png`, and `wt-*/`.
- `wt-*` worktree **mirrors are dropped** — `apps/*` is the single source of truth.
- Commit style: short imperative subject (`Add …`, `Fix …`), one logical change per commit, never commit generated output or screenshots.

## Dev-loop rules

- Use **`localhost`**, not `127.0.0.1`, for Next.js dev (`NEXT_PUBLIC_API_URL=http://localhost:8000`) — avoids cookie/CORS quirks.
- **Real `npm install`** (no junctions/symlinks into other trees) so `npm run dev/build` resolves cleanly.
- Clean up after verification: delete `.playwright-mcp/` output and stray screenshots; keep the repo screenshot-free (see [[Playwright-Workflow]]).

Related: [[Index]], [[Architecture]], [[Backend]], [[Frontend-CRM]], [[Mobile]], [[Database]], [[AI-Pipeline]], [[Playwright-Workflow]], [[Decisions-Log]].
