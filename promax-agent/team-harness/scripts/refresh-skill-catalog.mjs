import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG_FILE = join(ROOT, 'catalogs', 'skills.yml')

const skillRoots = [
  ['customer-research', '../../agents/customer-research/skills'],
  ['product-discovery', '../../agents/product-discovery/skills'],
  ['product-solution', '../../agents/product-solution/skills'],
  ['requirement-management', '../../agents/requirement-management/skills'],
  ['requirement-review', '../../agents/requirement-review/skills'],
  ['user-analysis', '../../agents/user-analysis/skills'],
  ['shared', '../../agents/shared/skills'],
]

const sha256 = value => createHash('sha256').update(value).digest('hex')

function treeHash(root) {
  const files = []
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files.push({
        relative_path: relative(root, path).split(sep).join('/'),
        sha256: sha256(readFileSync(path)),
      })
      else throw new Error(`unsupported skill entry: ${path}`)
    }
  }
  visit(root)
  return sha256(JSON.stringify(files))
}

function metadata(skillFile) {
  const text = readFileSync(skillFile, 'utf8')
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) throw new Error(`missing frontmatter: ${skillFile}`)
  return { text, value: YAML.parse(match[1]) }
}

const skills = []
for (const [, sourceRoot] of skillRoots) {
  const absoluteRoot = resolve(dirname(CATALOG_FILE), sourceRoot)
  for (const entry of readdirSync(absoluteRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const sourcePath = join(absoluteRoot, entry.name)
    const skillFile = join(sourcePath, 'SKILL.md')
    const parsed = metadata(skillFile)
    skills.push({
      skill_ref: `${entry.name}@1`,
      skill_id: entry.name,
      revision: 1,
      display_name: parsed.value.title ?? entry.name,
      description: parsed.value.description,
      status: 'allowed',
      source_path: sourceRoot + '/' + entry.name,
      content_sha256: sha256(readFileSync(skillFile)),
      tree_sha256: treeHash(sourcePath),
    })
  }
}

skills.sort((a, b) => a.skill_id.localeCompare(b.skill_id))
if (skills.length !== 28 || new Set(skills.map(skill => skill.skill_id)).size !== 28) {
  throw new Error(`expected exactly 28 unique skills, got ${skills.length}`)
}
writeFileSync(CATALOG_FILE, YAML.stringify({ schema_version: 1, skills }, { lineWidth: 0 }))
console.log(JSON.stringify({ skills: skills.length, unique_skill_ids: new Set(skills.map(skill => skill.skill_id)).size }))
