#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  applyPromptRecipe,
  appendWebEvidence,
  catalogResponse,
  captureWebSnapshot,
  compileTeam,
  ContractError,
  freezeEvidenceInput,
  HARNESS_DIR,
  importTeamConfiguration,
  instantiateTeam,
  loadAndValidate,
  readYaml,
  validateEvidenceInput,
  validateResourceManifest,
  verifyCompiledRevision,
} from './harness.mjs'
import { validateCustomerResearchReport } from './customer-research-validation.mjs'

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = { command }
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index]
    if (!key.startsWith('--')) throw new ContractError('无法识别的参数', [key])
    if (key === '--allow-overwrite') {
      options['allow-overwrite'] = true
      continue
    }
    const value = rest[index + 1]
    if (!value || value.startsWith('--')) throw new ContractError('参数缺少值', [key])
    options[key.slice(2)] = value
    index += 1
  }
  return options
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

try {
  const options = parseArgs(process.argv.slice(2))
  const catalogOptions = {
    modulesDir: resolve(options.modules ?? resolve(HARNESS_DIR, 'modules')),
    recipesDir: resolve(options.recipes ?? resolve(HARNESS_DIR, 'recipes')),
    skillCatalogFile: resolve(options.skills ?? resolve(HARNESS_DIR, 'catalogs/skills.yml')),
  }
  const common = {
    definitionFile: options.definition && resolve(options.definition),
    modulesDir: catalogOptions.modulesDir,
    toolProfilesFile: resolve(options['tool-profiles'] ?? resolve(HARNESS_DIR, 'catalogs/tool-profiles.yml')),
    skillCatalogFile: catalogOptions.skillCatalogFile,
    rubricCatalogFile: resolve(options.rubrics ?? resolve(HARNESS_DIR, 'catalogs/rubrics.yml')),
  }
  if (options.command === 'catalog') {
    print(catalogResponse(catalogOptions))
  } else if (options.command === 'apply-recipe') {
    if (!options.recipe || !options['team-id']) throw new ContractError('apply-recipe 需要 --recipe 与 --team-id')
    print(applyPromptRecipe({
      recipeRef: options.recipe,
      teamId: options['team-id'],
      displayName: options.name,
      description: options.description,
      ...catalogOptions,
    }))
  } else if (options.command === 'import') {
    if (!options.request) throw new ContractError('import 需要 --request <YAML/JSON>')
    print(importTeamConfiguration(readYaml(resolve(options.request)), catalogOptions))
  } else if (options.command === 'instantiate') {
    if (!options.request) throw new ContractError('instantiate 需要 --request <YAML/JSON>')
    print(instantiateTeam(readYaml(resolve(options.request)), {
      outputDir: resolve(options.output ?? resolve(HARNESS_DIR, 'generated')),
      ...catalogOptions,
    }))
  } else if (options.command === 'validate') {
    const result = loadAndValidate(common)
    print({ status: 'valid', team_id: result.definition.metadata.team_id, enabled_members: result.resolvedMembers.map(item => item.member.member_id) })
  } else if (options.command === 'validate-resources') {
    if (!options.manifest || !options.definition) throw new ContractError('validate-resources 需要 --manifest 与 --definition')
    const result = validateResourceManifest({ manifest: readYaml(resolve(options.manifest)), definition: readYaml(resolve(options.definition)) })
    print(result)
    if (!result.valid) process.exitCode = 1
  } else if (options.command === 'validate-customer-research') {
    if (!options.file) throw new ContractError('validate-customer-research 需要 --file <Markdown>')
    const result = validateCustomerResearchReport(readFileSync(resolve(options.file), 'utf8'))
    print(result)
    if (!result.valid) process.exitCode = 1
  } else if (options.command === 'freeze-input') {
    if (!options.request) throw new ContractError('freeze-input 需要 --request <YAML>')
    print(freezeEvidenceInput(readYaml(resolve(options.request))))
  } else if (options.command === 'validate-input') {
    if (!options.manifest) throw new ContractError('validate-input 需要 --manifest <manifest.yml>')
    print(validateEvidenceInput(resolve(options.manifest)))
  } else if (options.command === 'capture-web') {
    if (!options.url || !options.output) throw new ContractError('capture-web 需要 --url 与 --output')
    print(await captureWebSnapshot({ url: options.url, outputFile: options.output }))
  } else if (options.command === 'append-web-evidence') {
    if (!options.request) throw new ContractError('append-web-evidence 需要 --request <YAML>')
    const request = readYaml(resolve(options.request))
    print(appendWebEvidence({ ...request, content: readFileSync(resolve(request.content_file), 'utf8') }))
  } else if (options.command === 'compile' || options.command === 'publish') {
    print(compileTeam({
      ...common,
      revision: Number(options.revision),
      outputDir: resolve(options.output ?? resolve(HARNESS_DIR, 'generated')),
      allowOverwrite: options['allow-overwrite'] === true,
      archiveRoot: options['archive-root'] && resolve(options['archive-root']),
    }))
  } else if (options.command === 'verify') {
    if (!options.revision) throw new ContractError('verify 需要 --revision <目录>')
    print({ status: 'valid', ...verifyCompiledRevision(resolve(options.revision)) })
  } else {
    throw new ContractError('命令必须是 catalog、apply-recipe、instantiate、import、validate、validate-resources、validate-customer-research、freeze-input、validate-input、capture-web、append-web-evidence、publish/compile 或 verify')
  }
} catch (error) {
  const details = error instanceof ContractError ? error.details : []
  process.stderr.write(`${error.name ?? 'Error'}: ${error.message}\n`)
  for (const detail of details) process.stderr.write(`- ${JSON.stringify(detail)}\n`)
  process.exitCode = 1
}
