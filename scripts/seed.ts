// Deterministic seed for the dashboard assessment.
//
// Drops and recreates the local SQLite file at `data.db`, applies the schema
// from `schema.sql`, and inserts ~12 agents and ~3,000 calls across the last
// 21 days. Timestamps are relative to `now`, so "the last 7 days" is always
// populated regardless of when the candidate runs the seed. The RNG is seeded
// with a fixed string, so the dataset is byte-for-byte reproducible.
//
// Run via: pnpm seed

import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data.db");
const SCHEMA_PATH = path.join(ROOT, "schema.sql");

// ----- Deterministic RNG (mulberry32) ----------------------------------------

function hashSeed(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(hashSeed("armorhq-dashboard-assessment-v1"));

function randInt(min: number, max: number) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function weightedPick<T>(items: { value: T; weight: number }[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = rng() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

// ----- Reference data --------------------------------------------------------

const AGENTS: Array<{ name: string; team: string; tenureDays: number }> = [
  { name: "Maria Chen", team: "West Coast", tenureDays: 1240 },
  { name: "Devon Walker", team: "West Coast", tenureDays: 880 },
  { name: "Sasha Rios", team: "West Coast", tenureDays: 320 },
  { name: "Priya Natarajan", team: "Enterprise", tenureDays: 2010 },
  { name: "Marcus O'Neill", team: "Enterprise", tenureDays: 1670 },
  { name: "Hannah Liu", team: "Enterprise", tenureDays: 540 },
  { name: "Tomas Vega", team: "SMB", tenureDays: 95 },
  { name: "Gabriela Souza", team: "SMB", tenureDays: 410 },
  { name: "Jordan Kim", team: "SMB", tenureDays: 720 },
  { name: "Aisha Patel", team: "SMB", tenureDays: 3 },
  { name: "Riley Donovan", team: "Mid-Market", tenureDays: 1100 },
  { name: "Esteban Diaz", team: "Mid-Market", tenureDays: 800 },
];

const OUTCOMES = [
  { value: "connected" as const, weight: 30 },
  { value: "voicemail" as const, weight: 25 },
  { value: "no_answer" as const, weight: 30 },
  { value: "busy" as const, weight: 10 },
  { value: "failed" as const, weight: 5 },
];

function durationFor(outcome: string): number {
  if (outcome === "connected") return randInt(45, 720);
  if (outcome === "voicemail") return randInt(8, 45);
  if (outcome === "no_answer") return randInt(15, 35);
  if (outcome === "busy") return randInt(2, 8);
  return 0;
}

function fakePhone(): string {
  const area = randInt(201, 989);
  const exch = randInt(200, 999);
  const subs = randInt(1000, 9999);
  return `+1${area}${exch}${subs}`;
}

// ----- Seed run --------------------------------------------------------------

function main() {
  // Fresh start each run.
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  if (fs.existsSync(DB_PATH + "-journal")) fs.unlinkSync(DB_PATH + "-journal");
  if (fs.existsSync(DB_PATH + "-wal")) fs.unlinkSync(DB_PATH + "-wal");
  if (fs.existsSync(DB_PATH + "-shm")) fs.unlinkSync(DB_PATH + "-shm");

  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  console.log("Applying schema...");
  const schemaSql = fs.readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schemaSql);

  const now = Date.now();

  console.log("Inserting agents...");
  const insertAgent = db.prepare(
    `INSERT INTO agents (id, name, team, hire_date) VALUES (?, ?, ?, ?)`,
  );
  type Agent = { id: string; name: string; team: string };
  const agents: Agent[] = AGENTS.map((a) => {
    const id = randomUUID();
    const hireDate = new Date(now - a.tenureDays * 86400_000).toISOString().slice(0, 10);
    insertAgent.run(id, a.name, a.team, hireDate);
    return { id, name: a.name, team: a.team };
  });
  console.log(`Inserted ${agents.length} agents.`);

  // Generate calls. Per-agent volume varies by team.
  const teamMult: Record<string, number> = {
    SMB: 1.4,
    "West Coast": 1.1,
    "Mid-Market": 1.0,
    Enterprise: 0.6,
  };

  type Call = {
    id: string;
    agent_id: string;
    customer_phone: string;
    started_at: string;
    ended_at: string | null;
    duration_seconds: number;
    outcome: string;
  };
  const callRows: Call[] = [];

  for (const agent of agents) {
    if (agent.name === "Aisha Patel") continue;
    const baseCalls = 240;
    const mult = teamMult[agent.team] ?? 1;
    const callCount = Math.round(baseCalls * mult * (0.85 + rng() * 0.3));

    for (let i = 0; i < callCount; i++) {
      const daysAgo = rng() < 0.45 ? rng() * 7 : 7 + rng() * 14;
      const startMs = now - daysAgo * 86400_000;
      const startedAt = new Date(startMs);
      const day = startedAt.getUTCDay();
      if ((day === 0 || day === 6) && rng() < 0.5) continue;
      const hour = 8 + Math.floor(rng() * 10);
      startedAt.setUTCHours(hour, randInt(0, 59), randInt(0, 59), 0);

      const outcome = weightedPick(OUTCOMES);
      const duration = durationFor(outcome);
      const endedAt =
        outcome === "failed" ? null : new Date(startedAt.getTime() + duration * 1000);

      callRows.push({
        id: randomUUID(),
        agent_id: agent.id,
        customer_phone: fakePhone(),
        started_at: startedAt.toISOString(),
        ended_at: endedAt ? endedAt.toISOString() : null,
        duration_seconds: duration,
        outcome,
      });
    }
  }

  const misclickAgent = agents.find((a) => a.name !== "Aisha Patel")!;
  for (let i = 0; i < 5; i++) {
    const startedAt = new Date(now - randInt(1, 6) * 86400_000);
    callRows.push({
      id: randomUUID(),
      agent_id: misclickAgent.id,
      customer_phone: fakePhone(),
      started_at: startedAt.toISOString(),
      ended_at: startedAt.toISOString(),
      duration_seconds: 0,
      outcome: "connected",
    });
  }

  for (let i = 0; i < 2; i++) {
    const startedAt = new Date(now + (i + 1) * 86400_000);
    callRows.push({
      id: randomUUID(),
      agent_id: misclickAgent.id,
      customer_phone: fakePhone(),
      started_at: startedAt.toISOString(),
      ended_at: null,
      duration_seconds: 0,
      outcome: "connected",
    });
  }

  console.log(`Inserting ${callRows.length} calls...`);
  const insertCall = db.prepare(
    `INSERT INTO calls (id, agent_id, customer_phone, started_at, ended_at, duration_seconds, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec("BEGIN");
  try {
    for (const r of callRows) {
      insertCall.run(
        r.id,
        r.agent_id,
        r.customer_phone,
        r.started_at,
        r.ended_at,
        r.duration_seconds,
        r.outcome,
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  // Sanity log.
  const sevenDaysAgo = new Date(now - 7 * 86400_000).toISOString();
  const connectedLast7 = callRows.filter(
    (c) => c.outcome === "connected" && c.started_at >= sevenDaysAgo,
  ).length;

  console.log("");
  console.log("Seed complete.");
  console.log(`  Total calls:                       ${callRows.length}`);
  console.log(`  Connected calls in last 7 days:    ${connectedLast7}`);

  db.close();
}

main();
