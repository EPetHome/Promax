import type { DatabaseSync } from 'node:sqlite'

export interface RefreshTokenRecord {
  tokenHash: string
  employeeId: string
  chainId: string
  issuedAt: string
  expiresAt: string
}

export type RefreshTokenRotationResult =
  | { kind: 'rotated'; employeeId: string; chainId: string }
  | { kind: 'invalid' | 'expired' | 'reused' }

interface RefreshTokenRow {
  token_hash: string
  employee_id: string
  chain_id: string
  issued_at: string
  expires_at: string
  revoked_at: string | null
}

export interface RefreshTokenRepository {
  create(record: RefreshTokenRecord): void
  rotate(currentTokenHash: string, nextTokenHash: string, issuedAt: string, expiresAt: string): RefreshTokenRotationResult
  revokeOne(tokenHash: string, revokedAt: string): void
}

export class SqliteRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly database: DatabaseSync) {}

  create(record: RefreshTokenRecord): void {
    this.database.prepare(`
      INSERT INTO refresh_tokens (
        token_hash, employee_id, chain_id, issued_at, expires_at,
        revoked_at, revoked_reason, replaced_by_hash
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)
    `).run(record.tokenHash, record.employeeId, record.chainId, record.issuedAt, record.expiresAt)
  }

  rotate(currentTokenHash: string, nextTokenHash: string, issuedAt: string, expiresAt: string): RefreshTokenRotationResult {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const current = this.database.prepare(`
        SELECT token_hash, employee_id, chain_id, issued_at, expires_at, revoked_at
        FROM refresh_tokens WHERE token_hash = ?
      `).get(currentTokenHash) as RefreshTokenRow | undefined

      if (!current) {
        this.database.exec('COMMIT')
        return { kind: 'invalid' }
      }

      if (current.revoked_at !== null) {
        this.database.prepare(`
          UPDATE refresh_tokens
          SET revoked_at = COALESCE(revoked_at, ?),
              revoked_reason = CASE WHEN revoked_at IS NULL THEN 'reuse' ELSE revoked_reason END
          WHERE chain_id = ?
        `).run(issuedAt, current.chain_id)
        this.database.exec('COMMIT')
        return { kind: 'reused' }
      }

      if (Date.parse(current.expires_at) <= Date.parse(issuedAt)) {
        this.database.exec('COMMIT')
        return { kind: 'expired' }
      }

      this.database.prepare(`
        UPDATE refresh_tokens
        SET revoked_at = ?, revoked_reason = 'rotated', replaced_by_hash = ?
        WHERE token_hash = ? AND revoked_at IS NULL
      `).run(issuedAt, nextTokenHash, currentTokenHash)
      this.database.prepare(`
        INSERT INTO refresh_tokens (
          token_hash, employee_id, chain_id, issued_at, expires_at,
          revoked_at, revoked_reason, replaced_by_hash
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)
      `).run(nextTokenHash, current.employee_id, current.chain_id, issuedAt, expiresAt)
      this.database.exec('COMMIT')
      return { kind: 'rotated', employeeId: current.employee_id, chainId: current.chain_id }
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  revokeOne(tokenHash: string, revokedAt: string): void {
    this.database.prepare(`
      UPDATE refresh_tokens
      SET revoked_at = ?, revoked_reason = 'logout'
      WHERE token_hash = ? AND revoked_at IS NULL
    `).run(revokedAt, tokenHash)
  }
}
