import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'

const originalSpawn = childProcess.spawnSync

childProcess.spawnSync = function exitHelperAfterSwap(command, args, options) {
  if (Array.isArray(args) && String(args[1]).includes('ATOMIC_DIRECTORY_EXCHANGE_FAILED')) {
    const changed = [...args]
    changed[1] = changed[1].replace(
      'if result != 0:',
      'if result == 0:\n    os._exit(86)\n\nif result != 0:',
    )
    const result = originalSpawn.call(this, command, changed, options)
    process.stderr.write(`AUDIT_HELPER_EXIT=${result.status}\n`)
    process.exit(87)
  }
  return originalSpawn.call(this, command, args, options)
}

syncBuiltinESMExports()
