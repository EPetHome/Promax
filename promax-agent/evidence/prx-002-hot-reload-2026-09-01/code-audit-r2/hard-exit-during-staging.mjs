import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

const originalWrite = fs.writeFileSync
let stagingWrites = 0

fs.writeFileSync = function writeThenExit(path, ...args) {
  if (String(path).includes('.staging-') && ++stagingWrites === 2) {
    process.stderr.write('AUDIT_HARD_EXIT_DURING_STAGING\n')
    process.exit(86)
  }
  return originalWrite.call(this, path, ...args)
}

syncBuiltinESMExports()
