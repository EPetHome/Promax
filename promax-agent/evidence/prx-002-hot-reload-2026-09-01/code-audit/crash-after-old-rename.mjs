import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

const originalRename = fs.renameSync

fs.renameSync = function renameThenCrash(source, destination) {
  const result = originalRename.call(this, source, destination)
  if (String(source) === process.env.PRX002_AUDIT_TARGET && String(destination).includes('.backup-')) {
    process.stderr.write('AUDIT_CRASH_AFTER_OLD_RENAME\n')
    process.exit(86)
  }
  return result
}

syncBuiltinESMExports()
