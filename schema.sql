-- =============================================================================
-- ArmorHQ Dashboard Assessment — Database Schema
-- =============================================================================
-- SQLite. The seed script (`pnpm seed`) executes this file against `data.db`,
-- so any change here propagates after a re-seed.
--
-- Two tables: agents, calls.
-- =============================================================================


-- agents
-- -----------------------------------------------------------------------------
-- One row per dialer agent (the person making sales calls).
--
-- id           text          uuid string, primary key
-- name         text          full name, e.g. "Maria Chen"
-- team         text          team name, e.g. "West Coast", "Enterprise", "SMB"
-- hire_date    text          when they started, ISO 8601 date (YYYY-MM-DD)
-- created_at   text          row creation timestamp, ISO 8601

CREATE TABLE IF NOT EXISTS agents (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  team        TEXT NOT NULL,
  hire_date   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);


-- calls
-- -----------------------------------------------------------------------------
-- One row per outbound call.
--
-- id                text          uuid string, primary key
-- agent_id          text          references agents(id)
-- customer_phone    text          E.164, e.g. "+15558675309"
-- started_at        text          when the call began, ISO 8601 timestamp
-- ended_at          text          when the call ended (null only for failed)
-- duration_seconds  integer       length of the call. By definition: 0 only for
--                                 'failed' (no connection ever made); strictly
--                                 positive for everything else.
-- outcome           text          one of:
--                                   'connected' — customer answered, real conversation
--                                   'voicemail' — went to voicemail, agent left a message
--                                   'no_answer' — rang out, no voicemail
--                                   'busy'      — busy signal
--                                   'failed'    — carrier-level failure, no connection

CREATE TABLE IF NOT EXISTS calls (
  id                TEXT PRIMARY KEY,
  agent_id          TEXT NOT NULL REFERENCES agents(id),
  customer_phone    TEXT NOT NULL,
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  duration_seconds  INTEGER NOT NULL,
  outcome           TEXT NOT NULL CHECK (outcome IN ('connected','voicemail','no_answer','busy','failed')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_calls_agent ON calls(agent_id);
CREATE INDEX IF NOT EXISTS idx_calls_started ON calls(started_at);
