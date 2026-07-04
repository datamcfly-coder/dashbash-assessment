# ArmorHQ — Dana's Sales Dashboard

A week-over-week performance dashboard for Dana, head of a 200-person inside-sales
team. She didn't want another spreadsheet — she wanted two answers:

1. **Are my agents getting better or worse, week to week?**
2. **Who should I be talking to on Monday morning?**

The dashboard leads with those, in that order.

> The original assessment brief is preserved in [`TASK.md`](./TASK.md).

## Run it

```bash
nvm use            # Node 22.5+ (uses the built-in node:sqlite)
pnpm install
pnpm seed          # creates data.db (~12 agents, ~3,000 calls over 21 days)
pnpm dev           # http://localhost:3000
pnpm test          # metric tests (Vitest)
```

---

## What's on the dashboard, and why

Everything is framed as **this week vs. last week**, because that's the question Dana
actually asks. Top to bottom:

1. **The Monday number — connected calls, last 7 days.** The one figure she checks
   every Monday, shown big, with the change vs. the prior 7 days right beside it so
   "better or worse" is answered at a glance. Live-queried (reads `333` on the seed data).

2. **Team connect rate**, this week vs. last. Connect rate (`connected / total`) is the
   fairer "getting better?" signal than raw volume, because it doesn't reward whoever
   simply dialed more.

3. **"Talk to these on Monday"** — a short, *ranked* action list instead of a table to
   scan. Two kinds of agent surface here:
   - **Quiet** — had real volume last week, silent this week.
   - **Declining** — connect rate dropped by more than 3 points week-over-week.

   Both are **volume-gated** (≥20 calls in each week): a 2-of-4 day isn't a coaching
   signal, it's noise. A separate "worth a shout-out" line recognizes the biggest
   *improvers*, so Monday isn't only bad news.

4. **Teams this week** — each team's connect rate and direction.

5. **Every agent** — the whole floor, busiest first, with a 14-day sparkline of daily
   connected calls. Dana said "no spreadsheet," but she still wants to *see* everyone;
   this is scannable, not a data dump.

---

## The Monday number — exact definition and the edge cases

> Connected calls, last 7 days = `outcome = 'connected'` **AND** `started_at` within the
> last 7 days (a rolling 168-hour window).

Three decisions are baked into that query. They're in the seed data as traps, and they're
covered by tests:

- **Zero-duration "connected" rows count.** The schema says duration is `0` only for
  `failed`, but the data has stray zero-duration `connected` rows (mis-clicks). The metric
  is defined purely on *outcome + time* — no duration clause — so they count. Filtering
  them would be inventing a rule the definition doesn't state.

- **Window boundaries are computed in JavaScript as ISO strings, not with SQLite's
  `datetime('now')`.** `started_at` is stored as `2026-07-03T14:22:01.000Z`. SQLite's
  `datetime()` returns `2026-07-03 14:22:01` — a space instead of the `T`, no `Z`, no
  milliseconds — which does **not** sort correctly against the stored format and silently
  returns wrong rows near the boundary. So we build the boundary as
  `new Date(now - 7*86400_000).toISOString()` and compare with plain `>=`. This also
  matches the seed script's own definition of the metric byte-for-byte.

- **Rolling window vs. calendar days.** The headline (and all "last 7 days" totals) use a
  rolling 168-hour window. The per-day *trend charts* bucket by UTC calendar day, so a day
  with zero calls still shows up as a gap. Two different granularities, each right for its
  job.

All times are **UTC** — no per-agent timezone exists in the data, so UTC is the one honest
choice, and it's stated on the page.

---

## Architecture

- **One data layer.** Every query lives in [`src/lib/db.ts`](./src/lib/db.ts). The page and
  all four API routes are thin — they call a function and render/serialize the result. No
  SQL and no hardcoded numbers anywhere else.
- **Testable by construction.** Each query function takes an optional `db` handle and `now`
  timestamp (defaulting to the real DB and `Date.now()`), so tests run them against a
  controlled in-memory database with hand-placed timestamps.
- **Pure logic is separated from SQL.** Ranking ("who to talk to"), CSV escaping, rate math,
  and window helpers are plain functions — unit-tested directly, no DB needed.
- **UI** uses only the supplied shadcn components plus small local pieces
  (`Sparkline`, `TrendBadge`). Sparklines are hand-rolled inline SVG — no charting
  dependency added. The page is server-rendered (`force-dynamic`), so numbers are never
  stale and there's no client-side data fetching to go wrong. Mobile-first; verified at 375px.
  The ArmorHQ logo art is black, so it's inverted to white for the dark header.

## Reporting API

Machine-readable access to the same numbers. All four are live-queried and send
`Cache-Control: no-store`.

| Endpoint | Returns |
|---|---|
| `GET /api/weekly-digest` | 28 days of daily activity + top 3 agents this week (JSON) |
| `GET /api/weekly-digest.csv` | Same daily data as CSV (RFC 4180-escaped team names) for Google Sheets |
| `GET /api/agents/[id]/scorecard` | One agent's last 14 days + week-over-week totals; `404 agent_not_found` |
| `GET /api/teams/[name]/summary` | One team's 7-day roll-up, agents sorted by connects; `404 team_not_found` |

Team names arrive URL-encoded (`West%20Coast`); Next.js decodes the route segment, so it's
used as-is (no second decode, which would corrupt a name containing a literal `%`).

## Tests

`pnpm test` runs the metric suite ([`src/lib/db.test.ts`](./src/lib/db.test.ts)) — this is
what QA can re-run monthly to trust the numbers without re-deriving them. It builds a small
in-memory database with known timestamps and asserts exact counts, covering:

- the Monday number, including the zero-duration edge case and window boundaries;
- scorecard week-over-week totals and the `404` path;
- team roll-up, sorting, and the `404` path;
- the 28-day digest (zero-fill, per-team breakdown, top-agent tie-breaking);
- CSV escaping with a comma-laden team name;
- the "who to talk to" ranking rules and volume gate.

> **Note on `node:sqlite` + Vitest:** Vite 5.4 can't resolve the native `node:sqlite`
> builtin, so for test runs only it's aliased to a small `createRequire` shim
> ([`src/test/node-sqlite-shim.ts`](./src/test/node-sqlite-shim.ts)). The app code imports
> `node:sqlite` normally — Next.js handles it fine.

## Assumptions & trade-offs

- **Connect rate is the primary quality metric** (over talk time or raw connects) because
  it's comparable across agents with different dial volumes.
- **The 3-point / 20-call thresholds** for the attention list are deliberate, named
  constants in `db.ts` — easy to tune once Dana tells us what "meaningful" feels like.
- **UTC calendar days** for bucketing. If the team is single-timezone, shifting the day
  boundary is a one-line change in the date helpers.
