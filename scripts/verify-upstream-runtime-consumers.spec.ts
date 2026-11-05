import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  auditRepository,
  auditRuntimeConsumers,
  baselineProof,
  loadCensusCorrections,
  QUALIFIED_BASELINE_REVISION,
  type ProjectionDispositionRow,
  type RequestDispositionRow,
  type RuntimeConsumerSource,
  type RuntimeSiteSupplement,
  type CensusCorrection,
} from './verify-upstream-runtime-consumers.ts'

function row(partial: Partial<ProjectionDispositionRow> & Pick<ProjectionDispositionRow, 'id' | 'key'>): ProjectionDispositionRow {
  return {
    file: 'packages/owner/src/index.ts',
    stateVersion: 1,
    newOwner: 'the current registrant package, after it awaits the handle',
    awaited: false,
    ...partial,
  }
}

function audit(
  sources: readonly RuntimeConsumerSource[],
  registrations: readonly ProjectionDispositionRow[],
  listeners: readonly RequestDispositionRow[] = [],
  siteSupplement?: RuntimeSiteSupplement,
  readers: { id: string; file: string; key: string; method: string }[] = [],
  extra?: {
    corrections?: CensusCorrection[]
    readerReplacements?: { id: string; key: string; file: string; symbol: string; receiver?: string; line: number }[]
  },
) {
  return auditRuntimeConsumers({
    sources,
    projectionDispositions: { registrations },
    readers,
    requestDispositions: { listeners },
    ...siteSupplement === undefined ? {} : { siteSupplement },
    ...extra?.corrections === undefined ? {} : { corrections: extra.corrections },
    ...extra?.readerReplacements === undefined ? {} : { readerReplacements: extra.readerReplacements },
  })
}

const owner = row({ id: 'R01', key: 'alpha' })

describe('runtime consumer source audit', () => {
  it('rejects an ignored registration through an alias, a destructure, and get-service', () => {
    const sources = [
      source('packages/owner/src/alias.ts', `
        export function apply(ctx) {
          const projections = ctx.sessionProjections
          projections.register({ key: 'alpha', stateVersion: 1 })
        }
      `),
      source('packages/owner/src/destructure.ts', `
        export function apply(ctx) {
          const { register } = ctx.sessionProjections
          register({ key: 'alpha', stateVersion: 1 })
        }
      `),
      source('packages/owner/src/get.ts', `
        export function apply(ctx) {
          ctx.get('sessionProjections').register({ key: 'alpha', stateVersion: 1 })
        }
      `),
    ]
    const report = audit(sources, [owner])
    expect(report.accepted).toBe(false)
    expect(report.findings.filter(item => item.message.includes('synchronous registration'))).toHaveLength(3)
    expect(report.findings.some(item => item.message.includes('ignored'))).toBe(true)
    const messages = report.findings.map(item => item.message).join('\n')
    expect(messages).toContain('via alias')
    expect(messages).toContain('via destructure')
    expect(messages).toContain('via get-service')
  })

  it('checks every selected snapshot key against its exact reviewed reader', () => {
    const file = 'packages/consumer/src/index.ts'
    const supplement = { registrations: [], listeners: [], readers: [
      { id: 'view', file, method: 'snapshot', key: 'alpha' },
    ] }
    const checked = (keys: string) => audit([
      source(file, `export function read(ctx, session) { return ctx.sessionProjections.snapshot(session, ${keys}) }`),
    ], [], [], supplement)
    expect(checked("['alpha']").findings).toEqual([])
    expect(checked("['alpha', 'unexpected']").findings).toEqual([
      expect.objectContaining({ code: 'uncovered-caller', file }),
    ])
    expect(checked('[dynamicKey]').findings).toEqual([
      expect.objectContaining({ code: 'uncovered-caller', file }),
    ])
  })

  it('accepts an awaited registration of the disposition owner', () => {
    const report = audit([
      source('packages/owner/src/index.ts', `
        export async function apply(ctx) {
          const pending = [ctx.sessionProjections.register({ key: 'alpha', stateVersion: 1 })]
          await Promise.all(pending)
        }
      `),
    ], [owner])
    expect(report.findings).toEqual([])
    expect(report.rows[0]?.awaited).toBe(true)
    expect(report.rows[0]?.owner).toBe('packages/owner/src/index.ts')
    expect(report.rows[0]?.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(report.m2Closed).toBe(true)
  })

  it('accepts shared registrations of one canonical model-selection definition', () => {
    const definition = source('packages/core/agent/src/model-selection.ts', `
      export const modelSelectionProjectionDefinition = { key: 'modelSelection', stateVersion: 3 }
    `)
    const report = audit([
      definition,
      source('packages/core/agent-loop/src/index.ts', `
        import { modelSelectionProjectionDefinition } from '../../agent/src/model-selection.ts'
        export async function apply(ctx) {
          await ctx.sessionProjections.register(modelSelectionProjectionDefinition)
        }
      `),
      source('packages/api/session-controller/src/model-selection-projection.ts', `
        import { modelSelectionProjectionDefinition } from '../../../core/agent/src/model-selection.ts'
        export async function apply(ctx) {
          await ctx.sessionProjections.register(modelSelectionProjectionDefinition)
        }
      `),
    ], [row({
      id: 'R03',
      key: 'modelSelection',
      file: 'packages/api/session-controller/src/model-selection-projection.ts',
      stateVersion: 2,
      newOwner: 'packages/core/agent/src/model-selection.ts modelSelectionProjectionDefinition (tag stateVersion 3)',
    })], [], {
      registrations: [{ id: 'R03', key: 'modelSelection', file: 'packages/core/agent-loop/src/index.ts' }],
      readers: [],
      listeners: [],
    })
    expect(report.findings).toEqual([])
    expect(report.rows[0]?.shared).toBe(true)
    expect(report.rows[0]?.owner).toBe('packages/core/agent/src/model-selection.ts')
    expect(report.rows[0]?.stateVersion).toBe(3)
  })

  it('rejects a conflicting obsolete model-selection owner', () => {
    const report = audit([
      source('packages/core/agent/src/model-selection.ts', `
        export const modelSelectionProjectionDefinition = { key: 'modelSelection', stateVersion: 3 }
      `),
      source('packages/api/session-controller/src/model-selection-projection.ts', `
        import { modelSelectionProjectionDefinition } from '../../../core/agent/src/model-selection.ts'
        const legacy = { key: 'modelSelection', stateVersion: 2 }
        export async function apply(ctx) {
          await ctx.sessionProjections.register(modelSelectionProjectionDefinition)
          await ctx.sessionProjections.register(legacy)
        }
      `),
    ], [row({
      id: 'R03',
      key: 'modelSelection',
      file: 'packages/api/session-controller/src/model-selection-projection.ts',
      stateVersion: 2,
      newOwner: 'packages/core/agent/src/model-selection.ts modelSelectionProjectionDefinition (tag stateVersion 3)',
    })])
    expect(report.findings.some(item => item.code === 'obsolete-model-selection' || item.code === 'conflicting-owner')).toBe(true)
    expect(report.findings.some(item => item.message.includes('obsolete model-selection owner'))).toBe(true)
  })

  it('rejects a missing disposition and an uncovered caller', () => {
    const report = audit([
      source('packages/owner/src/index.ts', `
        export async function apply(ctx) {
          await ctx.sessionProjections.register({ key: 'media', stateVersion: 1 })
        }
      `),
    ], [owner])
    const messages = report.findings.map(item => item.message).join('\n')
    expect(messages).toContain('missing disposition')
    expect(messages).toContain('uncovered caller')
    expect(messages).toContain('unresolved source-owner mapping for R01 alpha')
  })

  it('rejects a retained listener that drops maxTokens and an adapt listener that still writes the route', () => {
    const listeners = [
      { id: 'L3', file: 'packages/experimental/assistant-registry/src/rounds.ts', decision: 'retain', mutates: ['maxTokens'] },
      { id: 'L2', file: 'packages/experimental/assistant-registry/src/route-override.ts', decision: 'adapt', mutates: ['provider', 'model', 'reasoningEffort'] },
    ]
    const report = audit([
      source('packages/experimental/assistant-registry/src/rounds.ts', `
        export function apply(ctx) {
          ctx.on('agent/request', () => ({ provider: 'other' }))
        }
      `),
      source('packages/experimental/assistant-registry/src/route-override.ts', `
        export function apply(ctx) {
          ctx.on('agent/request', () => ({ provider: 'other' }))
        }
      `),
    ], [], listeners)
    const messages = report.findings.map(item => item.message).join('\n')
    expect(messages).toContain('does not set maxTokens')
    expect(messages).toContain('mutates provider')
    expect(messages).toContain('missing image capability')
  })

  it('rejects a new caller of a known key unless that site is dispositioned', () => {
    const definition = source('packages/core/agent/src/model-selection.ts', `
      export const modelSelectionProjectionDefinition = { key: 'modelSelection', stateVersion: 3 }
    `)
    const sources = [
      definition,
      source('packages/api/session-controller/src/model-selection-projection.ts', `
        import { modelSelectionProjectionDefinition } from '../../../core/agent/src/model-selection.ts'
        export async function apply(ctx) {
          await ctx.sessionProjections.register(modelSelectionProjectionDefinition)
        }
      `),
      source('packages/extra/src/index.ts', `
        import { modelSelectionProjectionDefinition } from '../../core/agent/src/model-selection.ts'
        export async function apply(ctx) {
          await ctx.sessionProjections.register(modelSelectionProjectionDefinition)
        }
      `),
    ]
    const registrations = [row({
      id: 'R03',
      key: 'modelSelection',
      file: 'packages/api/session-controller/src/model-selection-projection.ts',
      stateVersion: 2,
      newOwner: 'packages/core/agent/src/model-selection.ts modelSelectionProjectionDefinition (tag stateVersion 3)',
    })]
    const blocked = audit(sources, registrations)
    expect(blocked.findings.some(item => item.message.includes('undispositioned registration site') && item.file === 'packages/extra/src/index.ts')).toBe(true)
    const allowed = audit(sources, registrations, [], {
      registrations: [{ id: 'R03', key: 'modelSelection', file: 'packages/extra/src/index.ts' }],
      readers: [],
      listeners: [],
    })
    expect(allowed.findings.filter(item => item.message.includes('undispositioned registration site'))).toEqual([])
  })

  it('rejects an undispositioned reader and an unlisted route listener', () => {
    const readers = [{ id: 'C01', file: 'packages/owner/src/index.ts', key: 'alpha', method: 'stateOf' }]
    const report = audit([
      source('packages/owner/src/index.ts', `
        export function apply(ctx) {
          ctx.sessionProjections.stateOf(session, 'alpha')
        }
      `),
      source('packages/other/src/index.ts', `
        export function apply(ctx) {
          ctx.sessionProjections.stateOf(session, 'alpha')
          ctx.on('agent/request', () => ({ provider: 'other' }))
        }
      `),
    ], [owner], [], undefined, readers)
    const messages = report.findings.map(item => item.message).join('\n')
    expect(messages).toContain('undispositioned reader site packages/other/src/index.ts')
    expect(messages).toContain('unlisted agent/request listener mutates the route')
    expect(messages).not.toContain('undispositioned reader site packages/owner/src/index.ts')
    expect(report.readers[0]?.present).toBe(true)
  })

  it('keeps the raw title census and rejects a version raised to match it', () => {
    const correction = {
      id: 'R25', key: 'title', symbol: 'titleProjectionDefinition', file: 'packages/session/session-title/src/index.ts',
      censusStateVersion: 3, actualStateVersion: 1, baselineHash: 'abc', behavior: 'title stays at stateVersion 1',
    }
    const registrations = [row({
      id: 'R25', key: 'title', file: 'packages/session/session-title/src/index.ts', stateVersion: 3,
      newOwner: 'the current registrant package, after it awaits the handle',
    })]
    const kept = audit([
      source('packages/session/session-title/src/index.ts', `
        export const titleProjectionDefinition = { key: 'title', stateVersion: 1 }
        export async function apply(ctx) {
          await ctx.sessionProjections.register(titleProjectionDefinition)
        }
      `),
    ], registrations, [], undefined, [], { corrections: [correction] })
    expect(kept.rows[0]?.m0StateVersion).toBe(3)
    expect(kept.rows[0]?.stateVersion).toBe(1)
    expect(kept.findings.some(item => item.message.includes('behavior regression'))).toBe(false)
    const raised = audit([
      source('packages/session/session-title/src/index.ts', `
        export const titleProjectionDefinition = { key: 'title', stateVersion: 3 }
        export async function apply(ctx) {
          await ctx.sessionProjections.register(titleProjectionDefinition)
        }
      `),
    ], registrations, [], undefined, [], { corrections: [correction] })
    expect(raised.rows[0]?.m0StateVersion).toBe(3)
    expect(raised.findings.some(item => item.message.includes('behavior regression') && item.message.includes('census 3 stays unchanged'))).toBe(true)
  })

  it('accepts an AST replacement call and rejects a text mention', () => {
    const readers = [{ id: 'C17', file: 'packages/owner/src/index.ts', key: 'turnBoundary', method: 'stateOf' }]
    const replacement = [{ id: 'C17', key: 'turnBoundary', file: 'packages/owner/src/index.ts', symbol: 'turnBoundaryOf', receiver: 'agents', line: 3 }]
    const textOnly = audit([
      source('packages/owner/src/index.ts', `
        export function apply(ctx) {
          const label = 'agents.turnBoundaryOf'
        }
      `),
    ], [owner], [], undefined, readers, { readerReplacements: replacement })
    expect(textOnly.findings.some(item => item.message.includes('has no current site'))).toBe(true)
    expect(textOnly.findings.some(item => item.message.includes('is not an AST call'))).toBe(true)
    const called = audit([
      source('packages/owner/src/index.ts', `
        export function apply(ctx) {
          return ctx.agents.turnBoundaryOf(session)
        }
      `),
    ], [owner], [], undefined, readers, { readerReplacements: replacement })
    expect(called.findings.some(item => item.message.includes('has no current site') || item.message.includes('is not an AST call'))).toBe(false)
    expect(called.readers[0]?.present).toBe(true)
  })

  it('fails loud when the checkout has no disposition ledger', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-ledger-'))
    try {
      expect(() => auditRepository(root)).toThrow('disposition ledger is missing')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a missing ledger from the validator command', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-cli-'))
    const modules = join(root, 'node_modules')
    try {
      mkdirSync(join(root, 'scripts'))
      cpSync(resolve(import.meta.dirname, 'verify-upstream-runtime-consumers.ts'), join(root, 'scripts/verify-upstream-runtime-consumers.ts'))
      symlinkSync(resolve(import.meta.dirname, '../node_modules'), modules, 'junction')
      const hook = fileURLToPath(import.meta.resolve('tsx/esm'))
      const result = spawnSync(process.execPath, ['--import', hook, join(root, 'scripts/verify-upstream-runtime-consumers.ts')], {
        cwd: root, encoding: 'utf8', timeout: 20_000,
      })
      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).toContain('disposition ledger is missing')
    } finally {
      if (existsSync(modules)) unlinkSync(modules)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps the repository audit closed', () => {
    const started = Date.now()
    const report = auditRepository(resolve(import.meta.dirname, '..'))
    const elapsed = Date.now() - started
    expect(elapsed).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(30_000)
    expect(report.accepted).toBe(false)
    expect(report.m2Closed).toBe(true)
    expect(report.rows).toHaveLength(32)
    expect(report.listeners).toHaveLength(4)
    expect(report.rows.map(item => item.id)).toEqual(Array.from({ length: 32 }, (_, index) => `R${String(index + 1).padStart(2, '0')}`))
    expect(report.rows.find(item => item.id === 'R25')?.m0StateVersion).toBe(3)
    expect(report.rows.find(item => item.id === 'R25')?.stateVersion).toBe(1)
    expect(report.rows.find(item => item.id === 'R03')?.m0StateVersion).toBe(2)
    expect(report.rows.find(item => item.id === 'R03')?.stateVersion).toBe(4)
    expect(report.readers.find(item => item.id === 'C24')?.present).toBe(true)
    expect(report.readers.find(item => item.id === 'C28')?.present).toBe(true)
    expect(report.findings.some(item => item.code === 'obsolete-model-selection')).toBe(false)
    expect(report.findings.some(item => item.message.includes('registers "media"'))).toBe(false)
    expect(report.findings.every(item => item.owner.includes('/'))).toBe(true)
    expect(report.findings.some(item => item.message.includes('HEAD'))).toBe(false)
    expect(report.findings).toEqual([])
  }, 30_000)

  it('anchors the title correction to the qualified blob and rejects a wrong hash or revision', () => {
    const root = resolve(import.meta.dirname, '..')
    const loaded = loadCensusCorrections(root)
    const title = loaded.corrections.find(item => item.id === 'R25')
    expect(title?.baselineRevision).toBe(QUALIFIED_BASELINE_REVISION)
    expect(title?.baselineHash).toBe('1e3994ae895f6b5f6e0b200e4c19cc0c43da02ddec689c0aef2fead792a7a264')
    expect(title?.baselineMatches).toBe(true)
    expect(title?.censusStateVersion).toBe(3)
    expect(title?.actualStateVersion).toBe(1)
    const raw = readFileSync(resolve(root, '.plans/rc1-execution/m1-runtime-corrections.json'), 'utf8')
    const wrongHash = loadCensusCorrections(root, raw.replace(title?.baselineHash ?? '', 'b'.repeat(64)))
    expect(wrongHash.corrections.find(item => item.id === 'R25')?.baselineMatches).toBe(false)
    const wrongRevision = loadCensusCorrections(root, raw.replace(QUALIFIED_BASELINE_REVISION, 'a'.repeat(40)))
    expect(wrongRevision.corrections.find(item => item.id === 'R25')?.baselineRevision).toBe('a'.repeat(40))
    expect(wrongRevision.corrections.find(item => item.id === 'R25')?.baselineMatches).toBe(false)
    expect(() => loadCensusCorrections(root, raw.replace(QUALIFIED_BASELINE_REVISION, 'HEAD'))).toThrow(/baselineRevision/)
    const mismatched = wrongHash.corrections.find(item => item.id === 'R25')
    if (mismatched === undefined) throw new Error('missing R25 correction')
    const report = audit([
      source('packages/session/session-title/src/index.ts', `
        export const titleProjectionDefinition = { key: 'title', stateVersion: 1 }
        export async function apply(ctx) {
          await ctx.sessionProjections.register(titleProjectionDefinition)
        }
      `),
    ], [row({
      id: 'R25', key: 'title', file: 'packages/session/session-title/src/index.ts', stateVersion: 3,
      newOwner: 'the current registrant package, after it awaits the handle',
    })], [], undefined, [], { corrections: [mismatched] })
    const message = report.findings.find(item => item.message.includes('baseline hash'))?.message ?? ''
    expect(message).toContain(QUALIFIED_BASELINE_REVISION)
    expect(message.includes('HEAD')).toBe(false)
    expect(report.rows[0]?.m0StateVersion).toBe(3)
    expect(report.rows[0]?.stateVersion).toBe(1)
    const selection = loaded.corrections.find(item => item.id === 'R03')
    expect(selection?.censusStateVersion).toBe(3)
    expect(selection?.actualStateVersion).toBe(4)
    expect(selection?.baselineHash).toBe('8e54dfda2e4a110148f384e0866ce0c6b213096d314aa84c222fa14155498571')
    expect(selection?.baselineMatches).toBe(true)
  })

  it('requires the committed baseline blob and rejects missing or conflicting proof', () => {
    const digest = '1e3994ae895f6b5f6e0b200e4c19cc0c43da02ddec689c0aef2fead792a7a264'
    expect(baselineProof(undefined, digest)).toBeUndefined()
    expect(baselineProof(digest, undefined)).toBe(digest)
    expect(baselineProof(digest, digest)).toBe(digest)
    expect(baselineProof(digest, 'b'.repeat(64))).toBeUndefined()
    const root = resolve(import.meta.dirname, '..')
    const raw = readFileSync(resolve(root, '.plans/rc1-execution/m1-runtime-corrections.json'), 'utf8')
    const temp = mkdtempSync(join(tmpdir(), 'runtime-baseline-'))
    try {
      const evidence = join(temp, '.plans/rc1-execution/baselines', QUALIFIED_BASELINE_REVISION)
      cpSync(resolve(root, '.plans/rc1-execution/baselines', QUALIFIED_BASELINE_REVISION), evidence, { recursive: true })
      const shallow = loadCensusCorrections(temp, raw)
      expect(shallow.corrections.find(item => item.id === 'R25')?.baselineMatches).toBe(true)
      expect(shallow.corrections.find(item => item.id === 'R03')?.baselineMatches).toBe(true)
      const title = join(evidence, 'packages/session/session-title/src/index.ts.txt')
      const unsuffixed = join(evidence, 'packages/session/session-title/src/index.ts')
      writeFileSync(unsuffixed, 'not-the-qualified-blob\n')
      expect(loadCensusCorrections(temp, raw).corrections.find(item => item.id === 'R25')?.baselineMatches).toBe(true)
      writeFileSync(title, 'not-the-qualified-blob\n')
      expect(loadCensusCorrections(temp, raw).corrections.find(item => item.id === 'R25')?.baselineMatches).toBe(false)
      rmSync(title)
      expect(loadCensusCorrections(temp, raw).corrections.find(item => item.id === 'R25')?.baselineMatches).toBe(false)
      const missingFile = raw.replace(
        '"file": "packages/session/session-title/src/index.ts"',
        '"file": "packages/session/session-title/src/missing-proof.ts"',
      )
      expect(loadCensusCorrections(root, missingFile).corrections.find(item => item.id === 'R25')?.baselineMatches).toBe(false)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it('accepts a reviewed unknown registration only when that file awaits the register', () => {
    const text = `
      export const mediaProjectionDefinition = { key: 'media', stateVersion: 1 }
      export async function apply(ctx) {
        const handle = await ctx.sessionProjections.register(mediaProjectionDefinition)
        return handle
      }
    `
    const supplement = {
      registrations: [{ id: 'media', key: 'media', file: 'packages/experimental/desktop-media/src/index.ts' }],
      readers: [],
      listeners: [],
    }
    const sources = [source('packages/experimental/desktop-media/src/index.ts', text)]
    const reviewed = audit(sources, [], [], supplement)
    expect(reviewed.findings.some(item => item.message.includes('registers "media"'))).toBe(false)
    const missing = audit(sources, [])
    expect(missing.findings.some(item => item.message.includes('registers "media"'))).toBe(true)
    const stale = audit([], [], [], supplement)
    expect(stale.findings.some(item => item.message.includes('is not an awaited AST register'))).toBe(true)
    const sync = audit([source('packages/experimental/desktop-media/src/index.ts', `
      export const mediaProjectionDefinition = { key: 'media', stateVersion: 1 }
      export function apply(ctx) {
        ctx.sessionProjections.register(mediaProjectionDefinition)
      }
    `)], [], [], supplement)
    expect(sync.findings.some(item => item.message.includes('synchronous registration'))).toBe(true)
  })

  it('rejects a non-positive per-case budget before scanning', () => {
    expect(() => auditRepository(resolve(import.meta.dirname, '..'), { timeoutMs: 0 })).toThrow('per-case timeout must be a positive integer')
  })

  it('rejects a real repository scan that exceeds its per-case timeout', () => {
    const root = resolve(import.meta.dirname, '..')
    const started = Date.now()
    expect(() => auditRepository(root, { timeoutMs: 1 })).toThrow(/per-case scan exceeded 1ms \(\d+ms\)/)
    expect(Date.now() - started).toBeGreaterThan(1)
  }, 30_000)
})

function source(path: string, text: string): RuntimeConsumerSource {
  return { path, text }
}
