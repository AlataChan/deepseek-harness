/**
 * REAL composition: the session-decisions service boots through the Loader
 * over real storage, the Remote surface answers over the real gateway,
 * missing required services fail load explicitly, a corrupt decision domain
 * isolates as an unavailable feature while ordinary boot continues, and a
 * disabled composition loads inert. Supporting storage plugins mount
 * directly on the test context; only the package under test loads from the
 * test-only cordis.yml (loader-composition pattern).
 * @module tests/composition
 */

import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as Include from '@deepseek-ai/cordis-plugin-include'
import * as yaml from 'js-yaml'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SessionDecisionsService from '../src/index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-session-decisions'
const DOMAIN_FILE = 'session_decisions.json'

interface Boot {
  ctx: Context
  root: string
  dispose(): Promise<void>
}

async function bootComposition(options: {
  withStorage?: boolean
  withSession?: boolean
  config?: Record<string, unknown>
  root?: string
  keepRoot?: boolean
}): Promise<Boot> {
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'session-decisions-comp-'))
  const cleanup = async (): Promise<void> => {
    if (options.keepRoot) return
    await rm(root, { recursive: true, force: true })
  }
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TypertGatewayService, {})
  if (options.withSession !== false) {
    // Minimal stand-ins for the required session path: the composition tests
    // exercise load and Remote wiring, not admission (admission.host.spec
    // boots the real controller). Missing any of these keeps the enabled
    // service waiting instead of activating.
    ctx.provide('sessionController', { prompt: async () => {
      throw new Error('composition stub never delivers prompts')
    } } as never)
    ctx.provide('sessions', {} as never)
    ctx.provide('agents', { list: () => [] } as never)
    ctx.provide('sessionProjections', { stateOf: () => undefined } as never)
  }
  if (options.withStorage !== false) {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
  }
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier: string): Promise<unknown> {
    if (specifier !== PACKAGE_NAME) throw new Error(`Unexpected Loader module: ${specifier}`)
    return { default: SessionDecisionsService }
  } } as never
  const configFile = join(root, 'cordis.yml')
  await writeFile(configFile, JSON.stringify([
    { id: 'session-decisions', name: PACKAGE_NAME, config: options.config ?? {} },
  ]))
  const created = ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configFile).href } })
  if (options.withSession === false) {
    // Enabled composition without the session path: the declarative gate
    // keeps the service loaded but waiting, never half-activated.
    await created
    await ctx.loader.await()
    for (const row of ctx.loader.entries()) await row.fiber?.await()
    return { ctx, root, dispose: () => ctx.fiber.dispose().then(cleanup) }
  }
  await created
  await ctx.loader.await()
  for (const row of ctx.loader.entries()) await row.fiber?.await()
  return {
    ctx,
    root,
    dispose: async () => {
      await ctx.fiber.dispose()
      await cleanup()
    },
  }
}

/** One valid persisted record in the storage-json single-unit layout. */
function recordFile(id: string): string {
  return JSON.stringify({
    unit: { name: 'session_decisions', version: 1 },
    global: null,
    tables: {
      decisions: {
        [id]: {
          formatVersion: 1,
          decisionId: id,
          sessionId: 'session-1',
          createdAtUtc: '2026-01-01T00:00:00.000Z',
          expiresAtUtc: '2026-01-02T00:00:00.000Z',
          revision: 0,
          question: 'q',
          choices: [],
          lifecycle: 'open',
          answerIndex: 'none',
          answer: null,
          suspension: null,
        },
      },
    },
  })
}

/** Typed gateway invoke for the feature's status Remote. */
function invokeStatus(ctx: Context): Promise<{ available: boolean; reason?: string }> {
  return ctx.typertGateway.invoke({ namespace: 'sessionDecisions', method: 'status', args: {} }) as Promise<{ available: boolean; reason?: string }>
}

it('boots through the Loader and serves the Remote surface over real storage', async () => {
  const boot = await bootComposition({})
  try {
    expect(await invokeStatus(boot.ctx)).toEqual({ available: true })
    const catalog = await boot.ctx.typertGateway.invoke({ namespace: 'sessionDecisions', method: 'catalog', args: { sessionId: 'session-1' } })
    expect(catalog).toEqual([])
  } finally {
    await boot.dispose()
  }
}, 15000)

it('fails load when the required storage-domain service is missing', async () => {
  const boot = await bootComposition({ withStorage: false })
  try {
    expect(boot.ctx.get('sessionDecisions')).toBeUndefined()
  } finally {
    await boot.dispose()
  }
}, 15000)

it('waits without failing load when the session path is missing in an enabled composition', async () => {
  // Declarative activation: the enabled service loads, reports the real
  // waiting state over the live Remote gateway, and stays unavailable until
  // the session path exists.
  const boot = await bootComposition({ withSession: false })
  try {
    expect(boot.ctx.get('sessionDecisions')).toBeDefined()
    const status = await invokeStatus(boot.ctx)
    expect(status.available).toBe(false)
    expect(status.reason).toContain('waiting for required services')
    await expect(boot.ctx.typertGateway.invoke({ namespace: 'sessionDecisions', method: 'catalog', args: { sessionId: 'session-1' } }))
      .rejects.toThrow()
  } finally {
    await boot.dispose()
  }
}, 15000)

it('isolates a corrupt decision domain as unavailable while ordinary boot continues', async () => {
  const first = await bootComposition({ keepRoot: true })
  const decisionId = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'
  await writeFile(join(first.root, DOMAIN_FILE), recordFile(decisionId))
  await first.dispose()

  // Corrupt the persisted record on the medium: schema-invalid revision.
  const medium = join(first.root, DOMAIN_FILE)
  const parsed = JSON.parse(await readFile(medium, 'utf8')) as Record<string, unknown>
  const tables = parsed.tables as { decisions: Record<string, Record<string, unknown>> }
  tables.decisions[decisionId]!.revision = -1
  await writeFile(medium, JSON.stringify(parsed))

  // Reboot over the corrupted medium with a fresh context.
  const reboot = await bootComposition({ root: first.root, keepRoot: true })
  try {
    const status = await invokeStatus(reboot.ctx)
    expect(status.available).toBe(false)
    expect(typeof status.reason).toBe('string')
    await expect(reboot.ctx.typertGateway.invoke({ namespace: 'sessionDecisions', method: 'catalog', args: { sessionId: 'session-1' } }))
      .rejects.toThrow()
    // Ordinary boot continues: the required session-path sibling and the
    // gateway that serves it are still live alongside the isolated feature.
    expect(reboot.ctx.get('sessionController')).toBeDefined()
    expect(reboot.ctx.typertGateway).toBeDefined()
  } finally {
    await reboot.dispose()
  }
}, 20000)

it('loads a disabled composition inert: no domain, no admission', async () => {
  const boot = await bootComposition({ config: { enabled: false } })
  try {
    const status = await invokeStatus(boot.ctx)
    expect(status.available).toBe(false)
    expect(String(status.reason)).toContain('disabled')
    await expect(boot.ctx.typertGateway.invoke({ namespace: 'sessionDecisions', method: 'catalog', args: { sessionId: 'session-1' } }))
      .rejects.toThrow()
  } finally {
    await boot.dispose()
  }
}, 15000)

/** One parsed patch file: the entry list (insert rows) it declares. */
interface PatchRow {
  id?: string
  name?: string
  insert?: Array<Record<string, unknown>>
  config?: unknown
}

async function parsePatch(relative: string): Promise<PatchRow[]> {
  const file = fileURLToPath(new URL(relative, import.meta.url))
  return yaml.load(await readFile(file, 'utf8'), { schema: Include.entryListSchema }) as PatchRow[]
}

/** The one inserted preset row with the given id from a patch file. */
async function presetRow(relative: string, rowId: string): Promise<{
  name: string
  config: { id: string; order: number; plugins: Array<{ id: string; name: string; config?: { mode?: string } }> }
}> {
  const data = await parsePatch(relative)
  const rows = data.flatMap(row => row.insert ?? [])
  const row = rows.find(entry => entry.id === rowId) as {
    name: string
    config: { id: string; order: number; plugins: Array<{ id: string; name: string; config?: { mode?: string } }> }
  } | undefined
  expect(row).toBeDefined()
  return row!
}

const FEATURE_ONLY_PLUGIN_IDS = new Set(['session-decisions-tools', 'tool-presentation'])
const STANDARD_PATCH = '../../../../packages/bundle/web-app/presets/standard.patch.yml'
const FEATURE_PATCH = '../preset.cordis.yml'

it('keeps the feature preset roster synchronized with the shipped standard preset', async () => {
  const standard = await presetRow(STANDARD_PATCH, 'preset-standard')
  const feature = await presetRow(FEATURE_PATCH, 'preset-persistent-questions')
  expect(feature.name).toBe('@deepseek-ai/dsh-agent-preset')
  expect(feature.config.id).toBe('persistent-questions')
  // The feature preset is opt-in selection; the shipped default stays standard.
  expect(feature.config.order).toBe(2)
  expect(standard.config.order).toBe(1)

  // Full-row roster: each plugin entry compares including its config, so an
  // option drift (not just an id/name change) fails this sync check too.
  type PresetPlugin = { id: string; name: string; config?: { mode?: string } }
  type PresetRow = { config: { plugins: PresetPlugin[] } }
  const roster = (row: PresetRow): PresetPlugin[] =>
    row.config.plugins.map(plugin => ({ ...plugin }))
  // Restated roster matches shipped standard exactly, minus the two feature
  // rows (the ./tools consumer and the explicit native presentation row).
  expect(roster(feature).filter(plugin => !FEATURE_ONLY_PLUGIN_IDS.has(plugin.id))).toEqual(roster(standard))

  const consumer = feature.config.plugins.find(plugin => plugin.id === 'session-decisions-tools')
  expect(consumer).toMatchObject({ name: '@deepseek-ai/dsh-experimental-session-decisions/tools' })
  // The explicit native row overrides process-wide DSH_TOOLS_MODE=ptc in
  // the supported untouched feature preset: a static literal, not env-derived.
  const presentation = feature.config.plugins.find(plugin => plugin.id === 'tool-presentation')
  expect(presentation).toMatchObject({ name: '@deepseek-ai/dsh-agent-tool-presentation', config: { mode: 'native' } })
})

it('saved profile edits win: consumer removal and PTC/both selection are never forced back', async () => {
  const feature = await presetRow(FEATURE_PATCH, 'preset-persistent-questions')
  const replace = (config: unknown): Include.PatchOptions => ({ id: 'preset-persistent-questions', config })
  const warn = (): void => {}

  // A saved edit removing the consumer is not restored.
  const withoutConsumer = structuredClone(feature.config)
  withoutConsumer.plugins = withoutConsumer.plugins.filter(plugin => plugin.id !== 'session-decisions-tools')
  const removed = Include.applyEntryPatches([feature as never], [replace(withoutConsumer)], warn)
  const removedPlugins = (removed[0]!.config as typeof withoutConsumer).plugins
  expect(removedPlugins.some(plugin => plugin.id === 'session-decisions-tools')).toBe(false)

  // A saved edit retaining the consumer but selecting PTC or both keeps the
  // user's mode (advertise-and-refuse is then the accepted limitation).
  for (const mode of ['ptc', 'both'] as const) {
    const edited = structuredClone(feature.config)
    for (const plugin of edited.plugins) {
      if (plugin.id === 'tool-presentation') plugin.config = { mode }
    }
    const applied = Include.applyEntryPatches([feature as never], [replace(edited)], warn)
    const presentation = (applied[0]!.config as typeof edited).plugins.find(plugin => plugin.id === 'tool-presentation')
    expect(presentation?.config).toEqual({ mode })
    expect((applied[0]!.config as typeof edited).plugins.some(plugin => plugin.id === 'session-decisions-tools')).toBe(true)
  }
})
