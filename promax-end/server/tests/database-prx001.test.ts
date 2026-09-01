import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'

import { openDatabase } from '../src/database.ts'

test('schema v7 migrates v6 telemetry without changing legacy agent, skill, or chat rows', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'promax-schema-v6-'))
  const path = join(directory, 'promax.sqlite')
  const legacy = new DatabaseSync(path)
  try {
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (
        employee_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        dept TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('member', 'admin')),
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO users VALUES ('10086', '脱敏用户', '演示部门', 'admin', 'hash', '2026-08-01T00:00:00Z');
      CREATE TABLE telemetry (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES users(employee_id),
        event_type TEXT NOT NULL CHECK (event_type IN ('agent', 'skill', 'chat')),
        target TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('hook', 'llm')),
        session_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
        output_files TEXT NOT NULL,
        received_at TEXT NOT NULL,
        UNIQUE (employee_id, session_id, occurred_at, target)
      ) STRICT;
      CREATE INDEX telemetry_occurred_idx ON telemetry(occurred_at DESC);
      CREATE INDEX telemetry_dimensions_idx ON telemetry(event_type, source, target);
      INSERT INTO telemetry VALUES
        ('evt_agent', '10086', 'agent', 'product-solution', 'hook', 'session-legacy', '2026-08-01T01:00:00Z', 'success', '[]', '2026-08-01T01:00:01Z'),
        ('evt_skill', '10086', 'skill', 'prd-writer', 'hook', 'session-legacy', '2026-08-01T01:01:00Z', 'success', '[]', '2026-08-01T01:01:01Z'),
        ('evt_chat', '10086', 'chat', '-', 'llm', 'session-legacy', '2026-08-01T01:02:00Z', 'failed', '[]', '2026-08-01T01:02:01Z');
      PRAGMA user_version = 6;
    `)
  } finally {
    legacy.close()
  }

  const migrated = openDatabase(path)
  try {
    const version = migrated.prepare('PRAGMA user_version').get() as { user_version: number }
    assert.equal(version.user_version, 7)
    const rows = migrated.prepare(`
      SELECT event_type, target, source, status, decision FROM telemetry ORDER BY occurred_at
    `).all() as Array<{ event_type: string, target: string, source: string, status: string, decision: null }>
    assert.deepEqual(rows.map(row => ({ ...row })), [
      { event_type: 'agent', target: 'product-solution', source: 'hook', status: 'success', decision: null },
      { event_type: 'skill', target: 'prd-writer', source: 'hook', status: 'success', decision: null },
      { event_type: 'chat', target: '-', source: 'llm', status: 'failed', decision: null },
    ])
    const taskStates = migrated.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_states'",
    ).get() as { name: string }
    assert.equal(taskStates.name, 'task_states')
  } finally {
    migrated.close()
    await rm(directory, { recursive: true, force: true })
  }
})
