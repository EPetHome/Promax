import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ArtifactKind } from '@promax/contracts'
import { parse } from 'yaml'

const EXTERNAL_ARTIFACT_KINDS = new Set<ArtifactKind>(['prd', 'diagram', 'prototype', 'other'])
const PRESET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

interface ArtifactDeclaration {
  readonly kind: ArtifactKind
  readonly relativePath: string
  readonly pattern: RegExp
  readonly producedBy: string
}

export interface TeamRevisionArtifactCatalog {
  readonly presetId: string
  kindFor(workspaceRelativePath: string): ArtifactKind | undefined
  producerFor(workspaceRelativePath: string): string | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeRelativePath(value: string): string | undefined {
  const normalized = value.replaceAll('\\', '/')
  if (normalized.length === 0 || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)) return undefined
  const segments = normalized.split('/')
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) return undefined
  return segments.join('/')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function artifactPattern(relativePath: string): RegExp {
  const segments = relativePath.split('/').map(segment => {
    if (segment === '{task_key}') return '[^/]+'
    if (segment.includes('{') || segment.includes('}')) {
      throw new Error(`promax-report: unsupported TeamRevision artifact placeholder in ${relativePath}`)
    }
    return escapeRegExp(segment)
  })
  return new RegExp(`^${segments.join('/')}$`, 'u')
}

function externalArtifactKind(value: unknown): ArtifactKind | undefined {
  return typeof value === 'string' && EXTERNAL_ARTIFACT_KINDS.has(value as ArtifactKind)
    ? value as ArtifactKind
    : undefined
}

function parseCatalog(source: string, expectedPresetId: string): TeamRevisionArtifactCatalog {
  const document: unknown = parse(source)
  if (!isRecord(document) || document.kind !== 'TeamRevision' || !isRecord(document.spec)) {
    throw new Error('promax-report: selected preset team-revision.yml is not a TeamRevision')
  }
  if (document.spec.preset_id !== expectedPresetId) {
    throw new Error(`promax-report: TeamRevision preset_id does not match selected preset ${expectedPresetId}`)
  }
  if (!Array.isArray(document.spec.artifacts)) {
    throw new Error(`promax-report: TeamRevision ${expectedPresetId} has no artifact declarations`)
  }

  const declarations: ArtifactDeclaration[] = []
  const declaredPaths = new Set<string>()
  for (const entry of document.spec.artifacts) {
    if (!isRecord(entry) || typeof entry.kind !== 'string' || typeof entry.relative_path !== 'string'
      || typeof entry.produced_by !== 'string' || !/^[a-z][a-z0-9_]*$/u.test(entry.produced_by)) {
      throw new Error(`promax-report: TeamRevision ${expectedPresetId} contains an invalid artifact declaration`)
    }
    const relativePath = normalizeRelativePath(entry.relative_path)
    if (!relativePath) {
      throw new Error(`promax-report: TeamRevision ${expectedPresetId} contains an unsafe artifact path`)
    }
    if (declaredPaths.has(relativePath)) {
      throw new Error(`promax-report: TeamRevision ${expectedPresetId} declares artifact path twice: ${relativePath}`)
    }
    declaredPaths.add(relativePath)

    if (entry.kind === 'judge-report') continue
    const kind = externalArtifactKind(entry.kind)
    if (!kind) {
      throw new Error(`promax-report: TeamRevision ${expectedPresetId} uses unsupported external artifact kind: ${entry.kind}`)
    }
    declarations.push({ kind, relativePath, pattern: artifactPattern(relativePath), producedBy: entry.produced_by })
  }

  return {
    presetId: expectedPresetId,
    kindFor(workspaceRelativePath: string): ArtifactKind | undefined {
      const normalized = normalizeRelativePath(workspaceRelativePath)
      if (!normalized) return undefined
      const matches = declarations.filter(declaration => declaration.pattern.test(normalized))
      if (matches.length === 0) return undefined
      if (matches.length !== 1) {
        throw new Error(`promax-report: TeamRevision ${expectedPresetId} has ambiguous artifact declarations for ${normalized}`)
      }
      return matches[0]?.kind
    },
    producerFor(workspaceRelativePath: string): string | undefined {
      const normalized = normalizeRelativePath(workspaceRelativePath)
      if (!normalized) return undefined
      const matches = declarations.filter(declaration => declaration.pattern.test(normalized))
      if (matches.length === 0) return undefined
      if (matches.length !== 1) {
        throw new Error(`promax-report: TeamRevision ${expectedPresetId} has ambiguous artifact producers for ${normalized}`)
      }
      return matches[0]?.producedBy
    },
  }
}

export function isJudgeReportPath(workspaceRelativePath: string): boolean {
  const normalized = normalizeRelativePath(workspaceRelativePath)
  if (!normalized) return false
  const segments = normalized.split('/')
  return segments[0] === '.promax' && segments[1] === 'judge'
}

export async function loadTeamRevisionArtifactCatalog(
  dshHome: string,
  presetId: string,
): Promise<TeamRevisionArtifactCatalog | undefined> {
  if (!PRESET_ID.test(presetId)) {
    throw new Error(`promax-report: unsafe selected preset id: ${presetId}`)
  }
  const path = join(dshHome, '.agent-presets', presetId, 'team-revision.yml')
  let source: string
  try {
    source = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  return parseCatalog(source, presetId)
}
