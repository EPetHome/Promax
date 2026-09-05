import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export class TelemetryStore {
  constructor(databaseFile) {
    this.file = resolve(databaseFile)
    mkdirSync(dirname(this.file), { recursive: true })
    this.database = new DatabaseSync(this.file)
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS capability_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        capability TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('hook', 'runtime')),
        UNIQUE (session_id, turn, event_type, capability, source)
      );
    `)
    this.insert = this.database.prepare(`
      INSERT OR IGNORE INTO capability_events
        (created_at, session_id, turn, event_type, capability, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
  }

  record({ sessionId, turn, eventType, capability, source }) {
    this.insert.run(new Date().toISOString(), String(sessionId), Number(turn), String(eventType), String(capability), String(source))
  }

  summary() {
    return this.database.prepare(`
      SELECT capability, source, COUNT(*) AS calls
      FROM capability_events
      GROUP BY capability, source
      ORDER BY calls DESC, capability ASC, source ASC
    `).all().map(row => ({ capability: row.capability, source: row.source, calls: Number(row.calls) }))
  }

  close() {
    this.database.close()
  }
}
