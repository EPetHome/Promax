import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const typesDirectory = join(packageDirectory, 'lib', 'types')
const sourceContract = resolve(packageDirectory, '..', '..', 'contracts', 'types.ts')
const packagedContract = join(typesDirectory, 'contracts.d.ts')

await writeFile(packagedContract, await readFile(sourceContract, 'utf8'))

for (const entry of await readdir(typesDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.d.ts') || entry.name === 'contracts.d.ts') continue
  const declaration = join(typesDirectory, entry.name)
  const target = join(typesDirectory, 'contracts.js')
  const path = relative(dirname(declaration), target).split(sep).join('/')
  const specifier = path.startsWith('.') ? path : `./${path}`
  const content = await readFile(declaration, 'utf8')
  const localized = content.replaceAll("from '@promax/contracts'", `from '${specifier}'`)
  await writeFile(declaration, localized)
}
