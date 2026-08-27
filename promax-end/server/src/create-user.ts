import type { EmployeeRole } from '@promax/contracts'

import { hashPassword } from './auth.ts'
import { loadServerConfig } from './config.ts'
import { openDatabase } from './database.ts'
import { SqliteUserRepository } from './user-repository.ts'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const role = required('PROMAX_USER_ROLE')
if (role !== 'member' && role !== 'admin') throw new Error('PROMAX_USER_ROLE must be member or admin')

const config = loadServerConfig()
const database = openDatabase(config.databasePath)
const users = new SqliteUserRepository(database)

try {
  users.create({
    employeeId: required('PROMAX_USER_EMPLOYEE_ID'),
    name: required('PROMAX_USER_NAME'),
    dept: required('PROMAX_USER_DEPT'),
    role: role as EmployeeRole,
    passwordHash: await hashPassword(required('PROMAX_USER_PASSWORD')),
    createdAt: new Date().toISOString(),
  })
  process.stdout.write('User created\n')
} finally {
  database.close()
}
