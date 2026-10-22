CREATE TABLE IF NOT EXISTS arena_profiles (
  email TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  profile_revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS arena_synced_events (
  id TEXT PRIMARY KEY,
  event_json TEXT NOT NULL,
  synced_at INTEGER NOT NULL,
  start_time INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS arena_synced_events_synced_at_idx
  ON arena_synced_events(synced_at DESC);

CREATE TABLE IF NOT EXISTS arena_runtime_state (
  state_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
