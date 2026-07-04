// Metric-calculation tests. These are what QA runs monthly to trust the numbers
// without re-deriving them by hand.
//
// Every query function accepts an explicit `db` and `now`, so here we build a
// tiny in-memory database with hand-placed calls at known offsets from a fixed
// "now" and assert exact counts. No dependence on the seed dataset — the point
// is that the *math* is correct for any data.

import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  agentsImproving,
  agentsNeedingAttention,
  connectRate,
  connectedCallsLast7Days,
  csvField,
  digestToCsv,
  getAgentScorecard,
  getTeamSummary,
  getWeeklyDigest,
  isoDaysAgo,
  lastNDates,
  type AgentTrend,
  type CallOutcome,
} from "./db";

// Fixed reference clock so every relative timestamp is deterministic.
const NOW = Date.parse("2026-07-15T12:00:00.000Z");
const DAY = 86_400_000;

const SCHEMA = fs.readFileSync(path.join(process.cwd(), "schema.sql"), "utf8");

let db: DatabaseSync;

function freshDb(): DatabaseSync {
  const d = new DatabaseSync(":memory:");
  d.exec(SCHEMA);
  return d;
}

function addAgent(name: string, team: string, hireDaysAgo = 100): string {
  const id = randomUUID();
  const hire = new Date(NOW - hireDaysAgo * DAY).toISOString().slice(0, 10);
  db.prepare(`INSERT INTO agents (id, name, team, hire_date) VALUES (?, ?, ?, ?)`).run(
    id,
    name,
    team,
    hire,
  );
  return id;
}

/** Insert `count` calls for an agent, all `daysAgo` before NOW, with a given outcome. */
function addCalls(
  agentId: string,
  daysAgo: number,
  outcome: CallOutcome,
  count = 1,
  durationSeconds = outcome === "failed" ? 0 : 60,
) {
  const stmt = db.prepare(
    `INSERT INTO calls (id, agent_id, customer_phone, started_at, ended_at, duration_seconds, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < count; i++) {
    // Spread within the day so multiple calls have distinct timestamps.
    const started = new Date(NOW - daysAgo * DAY + i * 1000).toISOString();
    const ended = outcome === "failed" ? null : new Date(NOW - daysAgo * DAY + i * 1000 + durationSeconds * 1000).toISOString();
    stmt.run(randomUUID(), agentId, "+15555550100", started, ended, durationSeconds, outcome);
  }
}

beforeEach(() => {
  db = freshDb();
});

describe("time-window helpers", () => {
  it("isoDaysAgo produces a comparable ISO string in the past", () => {
    expect(isoDaysAgo(7, NOW)).toBe("2026-07-08T12:00:00.000Z");
  });

  it("lastNDates returns N UTC dates, oldest first, ending today", () => {
    const dates = lastNDates(28, NOW);
    expect(dates).toHaveLength(28);
    expect(dates[27]).toBe("2026-07-15"); // today
    expect(dates[0]).toBe("2026-06-18"); // 27 days earlier
    // strictly ascending
    expect([...dates].sort()).toEqual(dates);
  });

  it("connectRate guards divide-by-zero", () => {
    expect(connectRate(0, 0)).toBe(0);
    expect(connectRate(3, 12)).toBe(0.25);
  });
});

describe("connectedCallsLast7Days — the Monday number", () => {
  it("counts connected calls inside the window and excludes everything else", () => {
    const a = addAgent("Alice", "West Coast");
    addCalls(a, 1, "connected", 2); // in window
    addCalls(a, 6, "connected", 1); // in window
    addCalls(a, 8, "connected", 5); // too old — excluded
    addCalls(a, 1, "voicemail", 4); // wrong outcome — excluded
    addCalls(a, 1, "no_answer", 3); // wrong outcome — excluded
    expect(connectedCallsLast7Days(db, NOW)).toBe(3);
  });

  it("counts a zero-duration 'connected' row (the misclick edge case)", () => {
    // The schema says duration is 0 only for 'failed', but the real data has
    // stray zero-duration 'connected' rows. The metric is defined purely on
    // outcome + time, so these DO count — this test locks that in.
    const a = addAgent("Bob", "West Coast");
    addCalls(a, 2, "connected", 1, 0); // duration 0, still connected
    expect(connectedCallsLast7Days(db, NOW)).toBe(1);
  });

  it("returns 0 when there are no calls at all", () => {
    addAgent("Empty", "SMB");
    expect(connectedCallsLast7Days(db, NOW)).toBe(0);
  });
});

describe("getAgentScorecard", () => {
  it("computes 14-day series and week-over-week totals", () => {
    const a = addAgent("Cara", "Enterprise");
    addCalls(a, 1, "connected", 3);
    addCalls(a, 1, "no_answer", 1); // total_7 becomes 4 -> rate 3/4 for those
    addCalls(a, 9, "connected", 2); // prior week
    addCalls(a, 20, "connected", 9); // outside 14 days -> not in series or totals

    const sc = getAgentScorecard(a, db, NOW)!;
    expect(sc).not.toBeNull();
    expect(sc.agent.name).toBe("Cara");
    expect(sc.last_14_days).toHaveLength(14);
    expect(sc.last_14_days[13].date).toBe("2026-07-15");
    expect(sc.totals.connected_last_7).toBe(3);
    expect(sc.totals.connected_prior_7).toBe(2);
    expect(sc.totals.connect_rate_last_7).toBe(3 / 4);
  });

  it("returns null for an unknown id (the route turns this into a 404)", () => {
    expect(getAgentScorecard("does-not-exist", db, NOW)).toBeNull();
  });
});

describe("getTeamSummary", () => {
  it("rolls up a team and sorts agents by connected desc", () => {
    const a1 = addAgent("Low", "West Coast");
    const a2 = addAgent("High", "West Coast");
    addCalls(a1, 1, "connected", 2);
    addCalls(a1, 1, "busy", 3);
    addCalls(a2, 2, "connected", 8);

    const ts = getTeamSummary("West Coast", db, NOW)!;
    expect(ts.team).toEqual({ name: "West Coast", agent_count: 2 });
    expect(ts.last_7_days.connected_count).toBe(10);
    expect(ts.last_7_days.total_count).toBe(13);
    expect(ts.last_7_days.connect_rate).toBeCloseTo(10 / 13, 10);
    // sorted: High (8) before Low (2)
    expect(ts.agents.map((a) => a.name)).toEqual(["High", "Low"]);
  });

  it("returns null for a team with no agents", () => {
    addAgent("Solo", "West Coast");
    expect(getTeamSummary("Nonexistent Team", db, NOW)).toBeNull();
  });
});

describe("getWeeklyDigest", () => {
  it("returns 28 zero-filled days, oldest first, with per-team breakdown", () => {
    const a = addAgent("Dana", "West Coast");
    const b = addAgent("Evan", "Enterprise");
    addCalls(a, 1, "connected", 2);
    addCalls(a, 1, "voicemail", 1); // total but not connected
    addCalls(b, 1, "connected", 1);

    const digest = getWeeklyDigest(db, NOW);
    expect(digest.data).toHaveLength(28);
    expect(digest.data[0].date).toBe("2026-06-18");
    expect(digest.data[27].date).toBe("2026-07-15");

    const yesterday = digest.data.find((d) => d.date === "2026-07-14")!;
    expect(yesterday.connected_count).toBe(3);
    expect(yesterday.total_count).toBe(4);
    expect(yesterday.by_team).toEqual({ "West Coast": 2, Enterprise: 1 });

    // A day with no calls is present and zeroed, not missing.
    const empty = digest.data.find((d) => d.date === "2026-06-20")!;
    expect(empty).toEqual({ date: "2026-06-20", connected_count: 0, total_count: 0, by_team: {} });
  });

  it("ranks top 3 agents by connected calls this week, breaking ties by name", () => {
    const zoe = addAgent("Zoe", "SMB");
    const amy = addAgent("Amy", "SMB");
    const ben = addAgent("Ben", "SMB");
    addCalls(zoe, 1, "connected", 5);
    addCalls(amy, 1, "connected", 5); // tie with Zoe -> Amy first (name asc)
    addCalls(ben, 1, "connected", 2);

    const { top_agents } = getWeeklyDigest(db, NOW);
    expect(top_agents.map((a) => a.name)).toEqual(["Amy", "Zoe", "Ben"]);
    expect(top_agents[0].connected_count).toBe(5);
  });
});

describe("CSV", () => {
  it("escapes fields containing commas and quotes per RFC 4180", () => {
    expect(csvField("West Coast")).toBe("West Coast"); // spaces don't need quoting
    expect(csvField("Enterprise, Inc")).toBe('"Enterprise, Inc"');
    expect(csvField('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvField(42)).toBe("42");
  });

  it("picks each day's busiest team and escapes a comma-laden team name", () => {
    const csv = digestToCsv([
      {
        date: "2026-07-14",
        connected_count: 5,
        total_count: 9,
        by_team: { "West Coast": 2, "Enterprise, Inc": 3 },
      },
      { date: "2026-07-15", connected_count: 0, total_count: 0, by_team: {} },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("date,connected_count,total_count,top_team,top_team_connects");
    expect(lines[1]).toBe('2026-07-14,5,9,"Enterprise, Inc",3');
    expect(lines[2]).toBe("2026-07-15,0,0,,0"); // empty day -> empty top_team
  });
});

describe("who to talk to on Monday", () => {
  function trend(partial: Partial<AgentTrend> & { id: string; name: string }): AgentTrend {
    return {
      team: "West Coast",
      connected_7: 0,
      total_7: 0,
      connected_prior_7: 0,
      total_prior_7: 0,
      rate_7: 0,
      rate_prior_7: 0,
      rate_delta: 0,
      daily_connected: [],
      ...partial,
    };
  }

  it("flags declining and quiet agents but ignores low-volume noise", () => {
    const dropped = trend({
      id: "1",
      name: "Dropped",
      total_7: 50,
      total_prior_7: 50,
      rate_7: 0.2,
      rate_prior_7: 0.35,
      rate_delta: -0.15,
    });
    const quiet = trend({ id: "2", name: "Quiet", total_7: 0, total_prior_7: 40 });
    const noisy = trend({
      id: "3",
      name: "Noisy",
      total_7: 4, // below the volume gate
      total_prior_7: 4,
      rate_7: 0,
      rate_prior_7: 1,
      rate_delta: -1,
    });
    const steady = trend({
      id: "4",
      name: "Steady",
      total_7: 50,
      total_prior_7: 50,
      rate_7: 0.3,
      rate_prior_7: 0.31,
      rate_delta: -0.01,
    });

    const result = agentsNeedingAttention([steady, dropped, quiet, noisy]);
    // Quiet listed before declining; low-volume Noisy and steady are excluded.
    expect(result.map((r) => `${r.agent.name}:${r.reason}`)).toEqual([
      "Quiet:quiet",
      "Dropped:declining",
    ]);
  });

  it("surfaces genuine improvers only", () => {
    const up = trend({ id: "1", name: "Up", total_7: 50, total_prior_7: 50, rate_delta: 0.08 });
    const flat = trend({ id: "2", name: "Flat", total_7: 50, total_prior_7: 50, rate_delta: 0.01 });
    expect(agentsImproving([flat, up]).map((a) => a.name)).toEqual(["Up"]);
  });
});
