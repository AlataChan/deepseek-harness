import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { IntakeRegistry } from './upstream-intake-registry.ts'
import {
  forbiddenDependencyViolations,
  mountRecordingViolations,
  neverMergeFileList,
  neverMergeViolations,
  patchRegistryViolations,
  removalDispositionViolations,
  upstreamIntakeViolations,
} from './verify-upstream-intake.ts'

/** A registry with one entry per rule, so a seeded violation is unambiguous. */
function fixtureRegistry(): IntakeRegistry {
  return {
    neverMerge: [
      { path: 'apps/desktop/src/account-backend.ts', tag: 'account-binding', reason: 'account surface' },
    ],
    patches: [
      { path: 'packages/fs/fs/src/index.ts', klass: 'A', reason: 'fork policy' },
      { path: 'packages/client/ui-sidebar/src/client/SidebarRoot.tsx', klass: 'B', reason: 'pending slot' },
    ],
    mounts: [
      {
        composition: 'packages/bundle/base/cordis.patch.yml',
        row: 'session-telemetry-otel',
        packageName: '@deepseek-ai/dsh-session-telemetry-otel',
        requiredChange: 'default the mode to DISABLED',
      },
    ],
    removals: [
      { path: 'packages/e2b', disposition: 'keep-fork-owned', reason: 'backs the fork sandbox path' },
    ],
    gatedPackageNames: ['@deepseek-ai/dsh-session-telemetry-otel', '@deepseek-ai/dsh-otel'],
    releaseCompositions: ['packages/bundle/base/cordis.patch.yml'],
    forkOwnedPaths: ['apps/desktop/', 'packages/experimental/'],
    upstreamOnlyDirectories: ['apps/desktop-host/'],
    forbiddenDependencies: ['electron', 'electron-builder', 'electron-updater'],
    guardedManifests: ['apps/desktop/package.json'],
  }
}

describe('rule 1 — never-merge paths', () => {
  it('reports an upstream account file that is present', () => {
    expect(neverMergeViolations(fixtureRegistry(), ['apps/desktop/src/account-backend.ts']))
      .toEqual([expect.stringContaining('apps/desktop/src/account-backend.ts: never-merge (account-binding)')])
  })

  it('reports an upstream-only directory as a violation only for files under it', () => {
    expect(neverMergeViolations(fixtureRegistry(), ['apps/desktop-host/src/office-engine.ts']))
      .toEqual([expect.stringContaining('lives under the upstream-only directory apps/desktop-host/')])
    expect(neverMergeViolations(fixtureRegistry(), ['apps/desktop/src/main.ts'])).toEqual([])
  })

  it('does not flag the fork’s own files in the collided desktop path', () => {
    const files = ['apps/desktop/src-tauri/Cargo.toml', 'apps/desktop/src/home.ts', 'apps/desktop/src/main.ts']
    expect(neverMergeViolations(fixtureRegistry(), files)).toEqual([])
  })

  it('rejects a directory entry left in the exact-path table, which would silently never match', () => {
    const registry = {
      ...fixtureRegistry(),
      neverMerge: [{ path: 'packages/client/product-analytics/', tag: 'product-analytics' as const, reason: 'analytics' }],
    }
    expect(neverMergeViolations(registry, ['packages/client/product-analytics/src/index.ts']))
      .toEqual([expect.stringContaining('registry error')])
  })
})

describe('rule 2 — the collided desktop path has not become Electron', () => {
  const manifest = (deps: Record<string, Record<string, string>>): string => JSON.stringify({ name: 'dsh-desktop', ...deps })

  it('accepts a manifest with no Electron runtime', () => {
    const files = new Map([['apps/desktop/package.json', manifest({ dependencies: { '@tauri-apps/api': '^2' } })]])
    expect(forbiddenDependencyViolations(fixtureRegistry(), path => files.get(path))).toEqual([])
  })

  it('rejects an Electron runtime in any dependency section', () => {
    const files = new Map([['apps/desktop/package.json', manifest({ devDependencies: { 'electron-builder': '^26' } })]])
    expect(forbiddenDependencyViolations(fixtureRegistry(), path => files.get(path)))
      .toEqual(["apps/desktop/package.json: declares electron-builder in devDependencies, adopting upstream's Electron application"])
  })

  it('reports an unparseable guarded manifest instead of passing it', () => {
    const files = new Map([['apps/desktop/package.json', '{ not json']])
    expect(forbiddenDependencyViolations(fixtureRegistry(), path => files.get(path)))
      .toHaveLength(1)
  })
})

describe('rule 1 — the disk walk reports files, never directories', () => {
  it('skips a leftover empty directory under an upstream-only path', () => {
    // The walk feeds rule 1, so a directory entry with no file beneath it must
    // not surface as upstream surface that leaked into the tree.
    const root = mkdtempSync(join(tmpdir(), 'intake-walk-'))
    mkdirSync(join(root, 'apps/desktop-host/src'), { recursive: true })
    writeFileSync(join(root, 'apps/desktop-host/package.json'), '{}')
    try {
      expect(neverMergeFileList(root, fixtureRegistry()).sort()).toEqual([
        'apps/desktop-host/package.json',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('rule 3 — release-composition mounts are recorded', () => {
  it('accepts a gated package that has a registry row', () => {
    const files = new Map([['packages/bundle/base/cordis.patch.yml', 'name: "@deepseek-ai/dsh-session-telemetry-otel"']])
    expect(mountRecordingViolations(fixtureRegistry(), path => files.get(path))).toEqual([])
  })

  it('rejects a gated package with no registry row', () => {
    const files = new Map([['packages/bundle/base/cordis.patch.yml', 'name: "@deepseek-ai/dsh-otel"']])
    expect(mountRecordingViolations(fixtureRegistry(), path => files.get(path)))
      .toEqual(['packages/bundle/base/cordis.patch.yml: mounts or depends on @deepseek-ai/dsh-otel with no registry row'])
  })

  it('ignores a gated package outside the release compositions', () => {
    const registry = { ...fixtureRegistry(), releaseCompositions: [] }
    const files = new Map([['packages/bundle/base/cordis.patch.yml', 'name: "@deepseek-ai/dsh-otel"']])
    expect(mountRecordingViolations(registry, path => files.get(path))).toEqual([])
  })
})

describe('rule 4 — edited upstream files are registered', () => {
  it('accepts a registered patch', () => {
    expect(patchRegistryViolations(['packages/fs/fs/src/index.ts'], fixtureRegistry())).toEqual([])
  })

  it('rejects an unregistered upstream edit', () => {
    expect(patchRegistryViolations(['packages/llm/provider/src/index.ts'], fixtureRegistry()))
      .toEqual(['packages/llm/provider/src/index.ts: edits an upstream file with no registry entry'])
  })

  it('does not demand an entry for a fork-owned file', () => {
    expect(patchRegistryViolations(['apps/desktop/src/home.ts'], fixtureRegistry())).toEqual([])
  })
})

describe('rule 5 — removed packages carry a disposition', () => {
  it('accepts a decided removal', () => {
    expect(removalDispositionViolations(fixtureRegistry())).toEqual([])
  })

  it('rejects an undecided removal', () => {
    const registry = { ...fixtureRegistry(), removals: [{ path: 'packages/e2b', disposition: undefined, reason: undefined }] }
    expect(removalDispositionViolations(registry))
      .toEqual(['packages/e2b: upstream removed it and no disposition is recorded'])
  })

  it('rejects a disposition with no reason', () => {
    const registry = { ...fixtureRegistry(), removals: [{ path: 'packages/e2b', disposition: 'keep-fork-owned' as const, reason: '  ' }] }
    expect(removalDispositionViolations(registry)).toHaveLength(1)
  })
})

describe('merge-time rules stay dormant before the merge', () => {
  const base = { root: '/fixture', registry: fixtureRegistry(), files: [] as string[], readFile: () => undefined }

  it('reports nothing when the changed-file list is absent', () => {
    expect(upstreamIntakeViolations(base)).toEqual([])
  })

  it('reports both merge-time families once the changed-file list is supplied', () => {
    const registry = { ...fixtureRegistry(), removals: [{ path: 'packages/e2b', disposition: undefined, reason: undefined }] }
    expect(upstreamIntakeViolations({ ...base, registry, changedUpstreamFiles: ['packages/llm/provider/src/index.ts'] }))
      .toEqual([
        'packages/llm/provider/src/index.ts: edits an upstream file with no registry entry',
        'packages/e2b: upstream removed it and no disposition is recorded',
      ])
  })
})

describe('the shipped registry satisfies the working-tree rules', () => {
  it('reports no violations against this checkout', async () => {
    const { REGISTRY, upstreamIntakeViolations: check } = await import('./verify-upstream-intake.ts')
    expect(check({ root: new URL('..', import.meta.url).pathname, registry: REGISTRY })).toEqual([])
  })
})
