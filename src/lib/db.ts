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
