# CLAUDE.md

**The user's name is Sahil.** Address them as Sahil (the git/email account may show a different name).

## Rule 0: Always greet first

**Begin every response with "Ok Sahil" before continuing with anything else.** No exceptions.

## Rule 0.5: Confirm understanding before acting

**Right after "Ok Sahil," restate two things — every reply, no exceptions:**
- **What I understood** from your prompt (in my own words).
- **What I'm going to do** about it.

Only then proceed. This lets you catch a misread before I act on it. Keep it short — roughly 1–5 sentences, not a hard cap, just don't write a wall of text.

## Rule 1: Read the CityWatch vault first

Project context, architecture, conventions, and integration details live in the **obsidian-citywatch** vault (MCP, backed by `C:\incident_reporter\vault_Citywatch`). Read it at the start of a session before working. Do not use the Travel Seasons vault for this repository.

## Rule 2: Database changes are migration-only

Supabase Postgres/PostGIS and Storage are the only data plane. So:

- Application data reads and writes go through the FastAPI backend; do not write directly to the database from Flutter or the CRM.
- Every schema change belongs in `supabase/migrations/`. Never apply a schema change only through MCP, and never edit an already-applied migration.
- New migration filenames use a real current UTC timestamp: `<YYYYMMDDHHMMSS>_<name>.sql`. When fixing a Jira ticket, include its key in `<name>`.
- Keep migration changes reviewable and do not push them directly to `main`; use the repository's branch/PR workflow.

## Rule 2.5: One worktree, only when told, closed out after merge

**Never create a git branch or worktree unless Sahil explicitly tells you to. Ask first, every time.**

When told to start one:
- Make exactly **one** worktree, right then — not a new one per ticket/issue that comes up later in the same session.
- Do all of that session's work in that same worktree. Don't spin up additional ones.
- Track which worktree is the active one — don't lose it.
- Never merge it until Sahil explicitly says so.
- Once it's merged, remove that worktree (and its branch) so it doesn't linger — clean up the one you just finished, not anything else.


## Rule 4: Exactly one backend process — never `--reload`

CityWatch has one FastAPI backend on port `8000` and one Next.js CRM on port `3000`. Never run uvicorn with `--reload` on this machine; on Windows it can leave a hidden worker serving stale code. Before starting the backend, kill the old process, verify zero leftover `spawn_main` Python processes and exactly one listener on port `8000`, then launch from `apps/backend` using the repository's configured Python environment. After backend edits, restart manually. Do not start duplicate CRM or backend processes.

## Rule 4.5: Migration-first, real-world verification

Never test a feature against an unprepared data plane. Before testing any schema- or storage-dependent change, verify that the migration is applied to the configured Supabase database and that the required table, bucket, or index exists. Automated tests and mocked Playwright tests are supplementary only. Acceptance verification must include real FastAPI API requests against the configured Supabase database and a real Playwright CLI walk through the running CRM with the actual user flow. Do not claim a feature works from mocked tests, UI navigation, or build checks alone; if the real API/UI flow was not exercised, state that explicitly.

For CRM browser checks, use the headed Playwright CLI interactively and click through the real flow. Do not add or retain Playwright test specs, Playwright configuration, an npm browser-test script, or automated browser test scripts.

## Rule 5: Save knowledge to the vault — always (enforceable, self-checked). and always make entry on index so any agent can find the note and make sure notes are linked properly together that are related.

**This is compulsory and NOT optional.** Whenever you learn durable knowledge, you MUST write it to the **obsidian-citywatch** vault via MCP — proactively, without being asked. Missing a durable fact is a rule violation, not a nice-to-have.

**A durable fact = anything still true next week that a fresh session would otherwise have to re-discover.** If you say, test, confirm, or correct any of the following, that is a **WRITE TRIGGER** — stop and record it before you move on:
- **Architecture / infra reality** — how envs, services, DBs, deploys actually wire up (e.g. "dev/prod/local share ONE DB, no isolation").
- **Locked decisions + the WHY** — a choice Sahil made and the reasoning behind it.
- **Integration contracts** — endpoints, webhook/callback URLs, tokens, required scopes/env vars, external-service setup steps.
- **Gotchas** — non-obvious traps, footguns, "looks like X but is actually Y."
- **Conventions** — patterns Sahil wants followed.

**Mechanic — run this every task, no exceptions:**
1. **Before you say "done," ask yourself: "Did I learn, confirm, or correct any durable fact this task?"** If yes → write it NOW, before ending the turn. Silently skipping this is the violation.
2. **Verify before you save.** Never record a claim you haven't confirmed from code/config or from Sahil. If a claim contradicts an existing note, resolve the contradiction first — don't save both.
3. **Fix wrong notes, don't just append.** If a vault note conflicts with reality, CORRECT it and tell Sahil you did — stale notes cause real accidents.
4. **One fact, findable.** Put it in the most relevant existing note (or a clearly-named new one); make the title / first line searchable.

**Never** store statuses / progress / changelogs / TODOs / "what I did today" — those go to git & Jira. The vault holds durable truth only.

CityWatch Jira tickets live in the `KAN` project. Use the connected official Atlassian/Rovo MCP for ticket lookup and updates; never copy OAuth tokens into the repository.

## Rule 6: Default to medium-length replies

Aim for a comfortable medium length by default — enough to answer well, not a wall of text. This is a default, not a hard cap: go longer only when the task genuinely needs it (a real plan, a tricky tradeoff, code that needs explaining), and go shorter when a sentence or two will do. When in doubt, trim recaps, hedging, and options I won't pursue rather than padding to fill space.

## Rule 7: UI is a first-class priority — build it fluid and proper

Treat UI quality as a real deliverable, not an afterthought. Every screen should feel fluid and polished: smooth loading states (no blank/half-rendered flashes), sensible transitions, responsive layout, correct spacing/alignment, and interactions that respond instantly. Do it properly — match the existing design language and conventions (loading spinners, pages over modals, in-app dialogs/toasts, Verdana typography), don't ship rough or "good enough" markup. If a UI needs more care than a quick change allows, say so rather than cutting corners.

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
