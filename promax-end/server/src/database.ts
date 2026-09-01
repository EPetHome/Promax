import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const SCHEMA_VERSION = 7

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const database = new DatabaseSync(path)
  database.exec('PRAGMA foreign_keys = ON')
  if (path !== ':memory:') database.exec('PRAGMA journal_mode = WAL')
  migrate(database)
  return database
}

function migrate(database: DatabaseSync): void {
  const current = database.prepare('PRAGMA user_version').get() as { user_version: number }
  if (current.user_version > SCHEMA_VERSION) {
    throw new Error(`Database schema ${current.user_version} is newer than supported ${SCHEMA_VERSION}`)
  }

  if (current.user_version < 1) {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE users (
        employee_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        dept TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('member', 'admin')),
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 1;
      COMMIT;
    `)
  }

  if (current.user_version < 2) {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE artifacts (
        artifact_id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES users(employee_id),
        project TEXT NOT NULL,
        agent TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('prd', 'diagram', 'prototype', 'other')),
        filename TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        sha256 TEXT NOT NULL UNIQUE,
        size INTEGER NOT NULL CHECK (size >= 0),
        created_at TEXT NOT NULL,
        received_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX artifacts_employee_created_idx ON artifacts(employee_id, created_at DESC);
      CREATE INDEX artifacts_project_kind_idx ON artifacts(project, kind);
      PRAGMA user_version = 2;
      COMMIT;
    `)
  }

  if (current.user_version < 3) {
    database.exec(`
      BEGIN IMMEDIATE;
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
      CREATE TABLE heartbeats (
        employee_id TEXT PRIMARY KEY REFERENCES users(employee_id),
        client_version TEXT NOT NULL,
        dsh_version TEXT NOT NULL,
        config_fingerprint TEXT NOT NULL,
        at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX heartbeats_at_idx ON heartbeats(at DESC);
      PRAGMA user_version = 3;
      COMMIT;
    `)
  }

  if (current.user_version < 4) {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE artifact_uploads (
        upload_id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES users(employee_id),
        project TEXT NOT NULL,
        agent TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('prd', 'diagram', 'prototype', 'other')),
        filename TEXT NOT NULL,
        created_at TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size INTEGER NOT NULL CHECK (size > 0),
        chunk_size INTEGER NOT NULL CHECK (chunk_size > 0),
        status TEXT NOT NULL CHECK (status IN ('receiving', 'completed')),
        artifact_id TEXT REFERENCES artifacts(artifact_id),
        started_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT;
      CREATE INDEX artifact_uploads_employee_status_idx ON artifact_uploads(employee_id, status);
      CREATE TABLE artifact_upload_chunks (
        upload_id TEXT NOT NULL REFERENCES artifact_uploads(upload_id) ON DELETE CASCADE,
        chunk_number INTEGER NOT NULL CHECK (chunk_number >= 0),
        size INTEGER NOT NULL CHECK (size > 0),
        sha256 TEXT NOT NULL,
        received_at TEXT NOT NULL,
        PRIMARY KEY (upload_id, chunk_number)
      ) STRICT;
      PRAGMA user_version = 4;
      COMMIT;
    `)
  }

  if (current.user_version < 5) {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE refresh_tokens (
        token_hash TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES users(employee_id),
        chain_id TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        revoked_reason TEXT CHECK (revoked_reason IN ('rotated', 'logout', 'reuse')),
        replaced_by_hash TEXT
      ) STRICT;
      CREATE INDEX refresh_tokens_employee_idx ON refresh_tokens(employee_id);
      CREATE INDEX refresh_tokens_chain_idx ON refresh_tokens(chain_id);
      CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens(expires_at);
      PRAGMA user_version = 5;
      COMMIT;
    `)
  }

  if (current.user_version < 6) {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE promate_operations (
        request_id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES users(employee_id),
        org_id TEXT NOT NULL,
        agent TEXT NOT NULL,
        artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
        project_id TEXT NOT NULL,
        requirement_id TEXT NOT NULL,
        artifact_type TEXT NOT NULL CHECK (artifact_type IN (
          '调研报告', '需求文档PRD', '产品方案', '原型',
          '评审记录', '技术方案', '竞品分析', '市场调研'
        )),
        summary TEXT NOT NULL,
        confirm_token TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('proposed', 'pending', 'synced', 'dead')),
        attempts INTEGER NOT NULL CHECK (attempts >= 0),
        commit_attempts INTEGER NOT NULL CHECK (commit_attempts >= 0),
        promate_artifact_id TEXT,
        requirement_url TEXT,
        last_error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX promate_operations_employee_idx ON promate_operations(employee_id, created_at DESC);
      CREATE INDEX promate_operations_status_idx ON promate_operations(status, updated_at);

      CREATE TABLE promate_calls (
        id INTEGER PRIMARY KEY,
        request_id TEXT NOT NULL,
        employee_id TEXT NOT NULL REFERENCES users(employee_id),
        org_id TEXT NOT NULL,
        agent TEXT NOT NULL,
        project_id TEXT,
        capability TEXT NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'pending')),
        error_code TEXT,
        occurred_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX promate_calls_request_idx ON promate_calls(request_id, occurred_at);
      CREATE INDEX promate_calls_employee_idx ON promate_calls(employee_id, occurred_at DESC);
      PRAGMA user_version = 6;
      COMMIT;
    `)
  }

  if (current.user_version < 7) {
    database.exec(`
      BEGIN IMMEDIATE;
      DROP INDEX telemetry_occurred_idx;
      DROP INDEX telemetry_dimensions_idx;
      ALTER TABLE telemetry RENAME TO telemetry_v6;
      CREATE TABLE telemetry (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES users(employee_id),
        event_type TEXT NOT NULL CHECK (event_type IN ('agent', 'skill', 'chat', 'decision')),
        target TEXT NOT NULL CHECK (
          event_type <> 'decision' OR target IN (
            'handoff.confirm', 'handoff.edit', 'coverage.override',
            'task.abandon', 'judge.force-release', 'judge.appeal'
          )
        ),
        source TEXT NOT NULL CHECK (source IN ('hook', 'llm')),
        session_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
        output_files TEXT NOT NULL,
        decision TEXT CHECK (
          (event_type = 'decision' AND decision IS NOT NULL)
          OR (event_type <> 'decision' AND decision IS NULL)
        ),
        received_at TEXT NOT NULL,
        UNIQUE (employee_id, session_id, occurred_at, target)
      ) STRICT;
      INSERT INTO telemetry (
        id, employee_id, event_type, target, source, session_id,
        occurred_at, status, output_files, decision, received_at
      )
      SELECT
        id, employee_id, event_type, target, source, session_id,
        occurred_at, status, output_files, NULL, received_at
      FROM telemetry_v6;
      DROP TABLE telemetry_v6;
      CREATE INDEX telemetry_occurred_idx ON telemetry(occurred_at DESC);
      CREATE INDEX telemetry_dimensions_idx ON telemetry(event_type, source, target);

      CREATE TABLE task_states (
        employee_id TEXT NOT NULL REFERENCES users(employee_id),
        task_key TEXT NOT NULL,
        project TEXT NOT NULL,
        session_id TEXT NOT NULL,
        tier TEXT NOT NULL CHECK (tier IN ('draft', 'single', 'team')),
        coverage_revision INTEGER NOT NULL CHECK (coverage_revision >= 1),
        updated_at TEXT NOT NULL,
        slots TEXT NOT NULL,
        received_at TEXT NOT NULL,
        PRIMARY KEY (employee_id, task_key)
      ) STRICT;
      CREATE INDEX task_states_session_task_idx ON task_states(session_id, task_key);
      PRAGMA user_version = 7;
      COMMIT;
    `)
  }
}
