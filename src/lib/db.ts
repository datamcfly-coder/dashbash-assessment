// The sanctioned data path. All dashboard and API queries go through here.
//
// Backed by a local SQLite file (`data.db` at the project root). The seed
// script creates it; `pnpm dev` reads it. Both use the same `getDb()` handle
// below.
//
// Uses Node's built-in `node:sqlite` (stable in Node 22.5+) so there is no
// native compile step on `pnpm install`. Schema is documented in /schema.sql.

import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const DB_PATH = path.join(process.cwd(), "data.db");

let _db: DatabaseSync | null = null;

/**
 * Returns a singleton SQLite handle. Lazy so that `import`-time side effects
 * don't open a file before the seed has had a chance to create it.
 *
 * Configured with WAL journaling and foreign-key enforcement, both of which
 * are off by default in SQLite and surprise people.
 */
export function getDb(): DatabaseSync {
  if (!_db) {
    _db = new DatabaseSync(DB_PATH);
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA foreign_keys = ON");
  }
  return _db;
}

// ----- Row types -------------------------------------------------------------

export type AgentRow = {
  id: string;
  name: string;
  team: string;
  hire_date: string;
  created_at: string;
};

export type CallOutcome = "connected" | "voicemail" | "no_answer" | "busy" | "failed";

export type CallRow = {
  id: string;
  agent_id: string;
  customer_phone: string;
  started_at: string; // ISO 8601
  ended_at: string | null; // ISO 8601, null only for failed
  duration_seconds: number;
  outcome: CallOutcome;
  created_at: string;
};

// =============================================================================
// Time windows
// =============================================================================
//
// The single most important rule in this file: how we define "the last N days".
//
// `started_at` is stored as an ISO 8601 UTC string ("2026-07-03T14:22:01.000Z").
// Two strings in that exact format sort chronologically when compared
// lexicographically, so we build our window boundaries as ISO strings *in JS*
// and compare with plain `>=` / `<`. We deliberately do NOT compare against
// SQLite's `datetime('now')`, whose output ("2026-07-03 14:22:01", a space
// instead of the 'T', no 'Z', no milliseconds) does not sort against our
// stored format — that mismatch silently returns wrong rows near the boundary.
//
// This also mirrors exactly how the seed script defines the metric
// (`new Date(now - 7 * 86400_000).toISOString()`), so the dashboard's headline
// number matches the operational definition byte-for-byte.

const DAY_MS = 86_400_000;

/** ISO timestamp for `days` before `now` (ms). The lower bound of a rolling window. */
export function isoDaysAgo(days: number, now: number = Date.now()): string {
  return new Date(now - days * DAY_MS).toISOString();
}

/** The UTC calendar date (YYYY-MM-DD) that an ISO timestamp falls on. */
export function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * The last `n` UTC calendar dates ending today, oldest first, as YYYY-MM-DD.
 * Used to build the per-day trend arrays so that days with zero calls still
 * appear (a gap in the chart is itself information Dana wants to see).
 * Arithmetic is done in UTC, which has no DST, so every step is exactly one day.
 */
export function lastNDates(n: number, now: number = Date.now()): string[] {
  const today = new Date(now).toISOString().slice(0, 10);
  const [y, m, d] = today.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(base - i * DAY_MS).toISOString().slice(0, 10));
  }
  return out;
}

/** `meta` block shared by every API endpoint. */
export type Meta = {
  generated_at: string;
  window_start: string;
  window_end: string;
};

function meta(dates: string[], now: number): Meta {
  return {
    generated_at: new Date(now).toISOString(),
    window_start: dates[0],
    window_end: dates[dates.length - 1],
  };
}

/** connect rate = connected / total, guarded against divide-by-zero. */
export function connectRate(connected: number, total: number): number {
  return total === 0 ? 0 : connected / total;
}

// =============================================================================
// The Monday number
// =============================================================================

/**
 * THE metric Dana checks every Monday: how many calls did we connect in the
 * last 7 days. Defined purely as `outcome = 'connected'` AND `started_at` within
 * the last 7 days (a rolling 168-hour window). No duration filter — a
 * zero-duration "connected" row still counts, because the definition is about
 * outcome and time, nothing else. Always live-queried.
 */
export function connectedCallsLast7Days(db: DatabaseSync = getDb(), now: number = Date.now()): number {
  const row = db
    .prepare(`SELECT count(*) AS c FROM calls WHERE outcome = 'connected' AND started_at >= ?`)
    .get(isoDaysAgo(7, now)) as { c: number };
  return row.c;
}

// =============================================================================
// Shared aggregate helpers
// =============================================================================

/** connected + total call counts inside a rolling window [now - days, now). */
function windowCounts(db: DatabaseSync, days: number, now: number) {
  const row = db
    .prepare(
      `SELECT
         count(*) AS total,
         sum(CASE WHEN outcome = 'connected' THEN 1 ELSE 0 END) AS connected
       FROM calls
       WHERE started_at >= ?`,
    )
    .get(isoDaysAgo(days, now)) as { total: number; connected: number | null };
  return { total: row.total, connected: row.connected ?? 0 };
}

// =============================================================================
// Dashboard (page at `/`)
// =============================================================================

export type AgentTrend = {
  id: string;
  name: string;
  team: string;
  connected_7: number;
  total_7: number;
  connected_prior_7: number;
  total_prior_7: number;
  rate_7: number;
  rate_prior_7: number;
  /** Change in connect rate vs the prior week, in rate units (−1..1). */
  rate_delta: number;
  /** Connected calls per day for the last 14 days, oldest first (sparkline). */
  daily_connected: number[];
};

export type TeamTrend = {
  team: string;
  agent_count: number;
  connected_7: number;
  total_7: number;
  rate_7: number;
  rate_prior_7: number;
  rate_delta: number;
};

export type Dashboard = {
  generated_at: string;
  /** The Monday number. */
  connected_7: number;
  connected_prior_7: number;
  total_7: number;
  rate_7: number;
  rate_prior_7: number;
  agents: AgentTrend[];
  teams: TeamTrend[];
};

/**
 * Everything the dashboard page needs, assembled here so the page component
 * stays a thin renderer. A small number of grouped queries, joined in JS.
 */
export function getDashboard(db: DatabaseSync = getDb(), now: number = Date.now()): Dashboard {
  const start7 = isoDaysAgo(7, now);
  const start14 = isoDaysAgo(14, now);

  // Per-agent connected/total for this week and the prior week, in one pass.
  // `prior` = [now-14d, now-7d); `this` = [now-7d, now).
  const perAgent = db
    .prepare(
      `SELECT
         a.id, a.name, a.team,
         sum(CASE WHEN c.started_at >= :s7 AND c.outcome = 'connected' THEN 1 ELSE 0 END) AS connected_7,
         sum(CASE WHEN c.started_at >= :s7 THEN 1 ELSE 0 END)                              AS total_7,
         sum(CASE WHEN c.started_at >= :s14 AND c.started_at < :s7 AND c.outcome = 'connected' THEN 1 ELSE 0 END) AS connected_prior_7,
         sum(CASE WHEN c.started_at >= :s14 AND c.started_at < :s7 THEN 1 ELSE 0 END)      AS total_prior_7
       FROM agents a
       LEFT JOIN calls c ON c.agent_id = a.id AND c.started_at >= :s14
       GROUP BY a.id
       ORDER BY a.name`,
    )
    .all({ s7: start7, s14: start14 }) as Array<{
    id: string;
    name: string;
    team: string;
    connected_7: number | null;
    total_7: number | null;
    connected_prior_7: number | null;
    total_prior_7: number | null;
  }>;

  // 14-day daily connected counts per agent, for sparklines.
  const dates14 = lastNDates(14, now);
  const dailyRows = db
    .prepare(
      `SELECT agent_id, substr(started_at, 1, 10) AS d, count(*) AS n
       FROM calls
       WHERE outcome = 'connected' AND started_at >= ?
       GROUP BY agent_id, d`,
    )
    .all(dates14[0] + "T00:00:00.000Z") as Array<{ agent_id: string; d: string; n: number }>;

  const dailyByAgent = new Map<string, Map<string, number>>();
  for (const r of dailyRows) {
    let m = dailyByAgent.get(r.agent_id);
    if (!m) dailyByAgent.set(r.agent_id, (m = new Map()));
    m.set(r.d, r.n);
  }

  const agents: AgentTrend[] = perAgent.map((a) => {
    const connected_7 = a.connected_7 ?? 0;
    const total_7 = a.total_7 ?? 0;
    const connected_prior_7 = a.connected_prior_7 ?? 0;
    const total_prior_7 = a.total_prior_7 ?? 0;
    const rate_7 = connectRate(connected_7, total_7);
    const rate_prior_7 = connectRate(connected_prior_7, total_prior_7);
    const perDay = dailyByAgent.get(a.id) ?? new Map();
    return {
      id: a.id,
      name: a.name,
      team: a.team,
      connected_7,
      total_7,
      connected_prior_7,
      total_prior_7,
      rate_7,
      rate_prior_7,
      rate_delta: rate_7 - rate_prior_7,
      daily_connected: dates14.map((d) => perDay.get(d) ?? 0),
    };
  });

  // Roll agents up into teams. We sum raw counts first, then derive rates once
  // at the end — a team's connect rate is total connected / total calls, never
  // an average of per-agent rates.
  type TeamAcc = {
    team: string;
    agent_count: number;
    connected_7: number;
    total_7: number;
    connected_prior_7: number;
    total_prior_7: number;
  };
  const teamMap = new Map<string, TeamAcc>();
  for (const a of agents) {
    let t = teamMap.get(a.team);
    if (!t) {
      t = {
        team: a.team,
        agent_count: 0,
        connected_7: 0,
        total_7: 0,
        connected_prior_7: 0,
        total_prior_7: 0,
      };
      teamMap.set(a.team, t);
    }
    t.agent_count += 1;
    t.connected_7 += a.connected_7;
    t.total_7 += a.total_7;
    t.connected_prior_7 += a.connected_prior_7;
    t.total_prior_7 += a.total_prior_7;
  }
  const teams: TeamTrend[] = [...teamMap.values()].map((t) => {
    const rate_7 = connectRate(t.connected_7, t.total_7);
    const rate_prior_7 = connectRate(t.connected_prior_7, t.total_prior_7);
    return {
      team: t.team,
      agent_count: t.agent_count,
      connected_7: t.connected_7,
      total_7: t.total_7,
      rate_7,
      rate_prior_7,
      rate_delta: rate_7 - rate_prior_7,
    };
  });
  teams.sort((a, b) => b.connected_7 - a.connected_7);

  const overall7 = windowCounts(db, 7, now);
  const overallPrior = db
    .prepare(
      `SELECT
         count(*) AS total,
         sum(CASE WHEN outcome = 'connected' THEN 1 ELSE 0 END) AS connected
       FROM calls WHERE started_at >= ? AND started_at < ?`,
    )
    .get(start14, start7) as { total: number; connected: number | null };

  return {
    generated_at: new Date(now).toISOString(),
    connected_7: overall7.connected,
    connected_prior_7: overallPrior.connected ?? 0,
    total_7: overall7.total,
    rate_7: connectRate(overall7.connected, overall7.total),
    rate_prior_7: connectRate(overallPrior.connected ?? 0, overallPrior.total),
    agents,
    teams,
  };
}

// =============================================================================
// "Who should I talk to on Monday?"
// =============================================================================
//
// Dana's second question. We turn the per-agent week-over-week trends into a
// short, ranked action list instead of another table to scan. Two pure
// functions (no DB) so the ranking rules are unit-tested directly.
//
// A drop only matters if there's enough volume behind it — a 2-of-4 vs 4-of-4
// week isn't a coaching signal, it's noise. `minVolume` gates both weeks.

/** Rate change (in percentage points) below which a week-over-week move is signal, not noise. */
const RATE_MOVE_THRESHOLD = 0.03;

export type AttentionReason = "declining" | "quiet";
export type AttentionItem = { agent: AgentTrend; reason: AttentionReason };

/**
 * Agents worth a Monday conversation, most urgent first. Two kinds:
 *  - "quiet": had real volume last week, silent this week (biggest prior week first).
 *  - "declining": connect rate fell by more than the threshold (biggest drop first).
 */
export function agentsNeedingAttention(agents: AgentTrend[], minVolume = 20): AttentionItem[] {
  const quiet = agents
    .filter((a) => a.total_prior_7 >= minVolume && a.total_7 === 0)
    .sort((a, b) => b.total_prior_7 - a.total_prior_7)
    .map((agent): AttentionItem => ({ agent, reason: "quiet" }));

  const declining = agents
    .filter(
      (a) =>
        a.total_7 >= minVolume &&
        a.total_prior_7 >= minVolume &&
        a.rate_delta <= -RATE_MOVE_THRESHOLD,
    )
    .sort((a, b) => a.rate_delta - b.rate_delta)
    .map((agent): AttentionItem => ({ agent, reason: "declining" }));

  return [...quiet, ...declining];
}

/** Agents whose connect rate climbed by more than the threshold — worth recognizing. */
export function agentsImproving(agents: AgentTrend[], minVolume = 20): AgentTrend[] {
  return agents
    .filter(
      (a) =>
        a.total_7 >= minVolume &&
        a.total_prior_7 >= minVolume &&
        a.rate_delta >= RATE_MOVE_THRESHOLD,
    )
    .sort((a, b) => b.rate_delta - a.rate_delta);
}

// =============================================================================
// API: /api/weekly-digest  (+ .csv)
// =============================================================================

export type DigestDay = {
  date: string;
  connected_count: number;
  total_count: number;
  by_team: Record<string, number>;
};

export type WeeklyDigest = {
  data: DigestDay[];
  top_agents: Array<{ name: string; team: string; connected_count: number }>;
  meta: Meta;
};

export function getWeeklyDigest(db: DatabaseSync = getDb(), now: number = Date.now()): WeeklyDigest {
  const dates = lastNDates(28, now);
  const lowerBound = dates[0] + "T00:00:00.000Z";

  // Per-day connected + total counts.
  const dayRows = db
    .prepare(
      `SELECT substr(started_at, 1, 10) AS d,
              count(*) AS total,
              sum(CASE WHEN outcome = 'connected' THEN 1 ELSE 0 END) AS connected
       FROM calls
       WHERE started_at >= ?
       GROUP BY d`,
    )
    .all(lowerBound) as Array<{ d: string; total: number; connected: number | null }>;
  const dayIndex = new Map(dayRows.map((r) => [r.d, r]));

  // Per-day, per-team connected counts.
  const teamRows = db
    .prepare(
      `SELECT substr(c.started_at, 1, 10) AS d, a.team AS team, count(*) AS connected
       FROM calls c JOIN agents a ON a.id = c.agent_id
       WHERE c.outcome = 'connected' AND c.started_at >= ?
       GROUP BY d, team`,
    )
    .all(lowerBound) as Array<{ d: string; team: string; connected: number }>;
  const byTeamIndex = new Map<string, Record<string, number>>();
  for (const r of teamRows) {
    let m = byTeamIndex.get(r.d);
    if (!m) byTeamIndex.set(r.d, (m = {}));
    m[r.team] = r.connected;
  }

  const data: DigestDay[] = dates.map((date) => {
    const row = dayIndex.get(date);
    return {
      date,
      connected_count: row?.connected ?? 0,
      total_count: row?.total ?? 0,
      by_team: byTeamIndex.get(date) ?? {},
    };
  });

  // Top 3 agents by connected calls in the rolling last 7 days.
  const top_agents = db
    .prepare(
      `SELECT a.name, a.team, count(*) AS connected_count
       FROM calls c JOIN agents a ON a.id = c.agent_id
       WHERE c.outcome = 'connected' AND c.started_at >= ?
       GROUP BY a.id
       ORDER BY connected_count DESC, a.name ASC
       LIMIT 3`,
    )
    .all(isoDaysAgo(7, now)) as Array<{ name: string; team: string; connected_count: number }>;

  return { data, top_agents, meta: meta(dates, now) };
}

// ----- CSV -------------------------------------------------------------------

/** RFC 4180 field escaping: quote if the value contains a comma, quote, or newline. */
export function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Turn digest days into the CSV the CS team drops into Sheets. For each day we
 * also compute the single busiest team (`top_team`) and its connect count.
 * Ties break alphabetically so the output is deterministic across re-runs.
 */
export function digestToCsv(days: DigestDay[]): string {
  const header = ["date", "connected_count", "total_count", "top_team", "top_team_connects"];
  const lines = [header.join(",")];
  for (const day of days) {
    let topTeam = "";
    let topConnects = 0;
    for (const [team, connects] of Object.entries(day.by_team).sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      if (connects > topConnects) {
        topTeam = team;
        topConnects = connects;
      }
    }
    lines.push(
      [
        csvField(day.date),
        csvField(day.connected_count),
        csvField(day.total_count),
        csvField(topTeam),
        csvField(topConnects),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

// =============================================================================
// API: /api/agents/[id]/scorecard
// =============================================================================

export type Scorecard = {
  agent: { id: string; name: string; team: string; hire_date: string };
  last_14_days: Array<{ date: string; connected_count: number; total_count: number }>;
  totals: { connected_last_7: number; connected_prior_7: number; connect_rate_last_7: number };
  meta: Meta;
};

/** Returns null when no agent has that id (the route turns that into a 404). */
export function getAgentScorecard(
  id: string,
  db: DatabaseSync = getDb(),
  now: number = Date.now(),
): Scorecard | null {
  const agent = db
    .prepare(`SELECT id, name, team, hire_date FROM agents WHERE id = ?`)
    .get(id) as { id: string; name: string; team: string; hire_date: string } | undefined;
  if (!agent) return null;

  const dates = lastNDates(14, now);
  const rows = db
    .prepare(
      `SELECT substr(started_at, 1, 10) AS d,
              count(*) AS total,
              sum(CASE WHEN outcome = 'connected' THEN 1 ELSE 0 END) AS connected
       FROM calls
       WHERE agent_id = ? AND started_at >= ?
       GROUP BY d`,
    )
    .all(id, dates[0] + "T00:00:00.000Z") as Array<{
    d: string;
    total: number;
    connected: number | null;
  }>;
  const index = new Map(rows.map((r) => [r.d, r]));
  const last_14_days = dates.map((date) => {
    const r = index.get(date);
    return { date, connected_count: r?.connected ?? 0, total_count: r?.total ?? 0 };
  });

  const t = db
    .prepare(
      `SELECT
         sum(CASE WHEN started_at >= :s7 AND outcome = 'connected' THEN 1 ELSE 0 END) AS connected_7,
         sum(CASE WHEN started_at >= :s7 THEN 1 ELSE 0 END)                            AS total_7,
         sum(CASE WHEN started_at >= :s14 AND started_at < :s7 AND outcome = 'connected' THEN 1 ELSE 0 END) AS connected_prior_7
       FROM calls
       WHERE agent_id = :id AND started_at >= :s14`,
    )
    .get({ id, s7: isoDaysAgo(7, now), s14: isoDaysAgo(14, now) }) as {
    connected_7: number | null;
    total_7: number | null;
    connected_prior_7: number | null;
  };
  const connected_last_7 = t.connected_7 ?? 0;
  const total_last_7 = t.total_7 ?? 0;

  return {
    agent,
    last_14_days,
    totals: {
      connected_last_7,
      connected_prior_7: t.connected_prior_7 ?? 0,
      connect_rate_last_7: connectRate(connected_last_7, total_last_7),
    },
    meta: meta(dates, now),
  };
}

// =============================================================================
// API: /api/teams/[name]/summary
// =============================================================================

export type TeamSummary = {
  team: { name: string; agent_count: number };
  last_7_days: { connected_count: number; total_count: number; connect_rate: number };
  agents: Array<{ id: string; name: string; connected_count: number; total_count: number }>;
  meta: Meta;
};

/** Returns null when the team has no agents (the route turns that into a 404). */
export function getTeamSummary(
  name: string,
  db: DatabaseSync = getDb(),
  now: number = Date.now(),
): TeamSummary | null {
  const start7 = isoDaysAgo(7, now);
  const agents = db
    .prepare(
      `SELECT
         a.id, a.name,
         sum(CASE WHEN c.outcome = 'connected' THEN 1 ELSE 0 END) AS connected_count,
         count(c.id) AS total_count
       FROM agents a
       LEFT JOIN calls c ON c.agent_id = a.id AND c.started_at >= :s7
       WHERE a.team = :name
       GROUP BY a.id
       ORDER BY connected_count DESC, a.name ASC`,
    )
    .all({ name, s7: start7 }) as Array<{
    id: string;
    name: string;
    connected_count: number | null;
    total_count: number;
  }>;

  if (agents.length === 0) return null;

  const rows = agents.map((a) => ({
    id: a.id,
    name: a.name,
    connected_count: a.connected_count ?? 0,
    total_count: a.total_count,
  }));
  const connected_count = rows.reduce((s, a) => s + a.connected_count, 0);
  const total_count = rows.reduce((s, a) => s + a.total_count, 0);

  return {
    team: { name, agent_count: rows.length },
    last_7_days: {
      connected_count,
      total_count,
      connect_rate: connectRate(connected_count, total_count),
    },
    agents: rows,
    meta: meta(lastNDates(7, now), now),
  };
}
