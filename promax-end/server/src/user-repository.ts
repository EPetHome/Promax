import type { EmployeeRole } from '@promax/contracts'
import type { DatabaseSync } from 'node:sqlite'

export interface UserRecord {
  employeeId: string
  name: string
  dept: string
  role: EmployeeRole
  passwordHash: string
}

export interface CreateUserInput extends UserRecord {
  createdAt: string
}

export interface UserRepository {
  create(input: CreateUserInput): void
  findByEmployeeId(employeeId: string): UserRecord | undefined
}

interface UserRow {
  employee_id: string
  name: string
  dept: string
  role: EmployeeRole
  password_hash: string
}

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly database: DatabaseSync) {}

  create(input: CreateUserInput): void {
    this.database.prepare(`
      INSERT INTO users (employee_id, name, dept, role, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.employeeId, input.name, input.dept, input.role, input.passwordHash, input.createdAt)
  }

  findByEmployeeId(employeeId: string): UserRecord | undefined {
    const row = this.database.prepare(`
      SELECT employee_id, name, dept, role, password_hash
      FROM users
      WHERE employee_id = ?
    `).get(employeeId) as UserRow | undefined

    if (!row) return undefined
    return {
      employeeId: row.employee_id,
      name: row.name,
      dept: row.dept,
      role: row.role,
      passwordHash: row.password_hash,
    }
  }
}
