import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

const target = process.env.PRX002_AUDIT_TARGET
const mode = process.env.PRX002_AUDIT_MODE
const originalRename = fs.renameSync
const originalRemove = fs.rmSync

if (mode === 'promotion-and-rollback') {
  fs.renameSync = function failPromotionAndRollback(source, destination) {
    if (String(source).includes('.staging-') && String(destination) === target) {
      throw new Error('AUDIT_PROMOTION_FAILURE')
    }
    if (String(source).includes('.backup-') && String(destination) === target) {
      throw new Error('AUDIT_ROLLBACK_FAILURE')
    }
    return originalRename.call(this, source, destination)
  }
}

if (mode === 'backup-cleanup') {
  fs.rmSync = function failBackupCleanup(path, options) {
    if (String(path).includes('.backup-')) throw new Error('AUDIT_BACKUP_CLEANUP_FAILURE')
    return originalRemove.call(this, path, options)
  }
}

syncBuiltinESMExports()
