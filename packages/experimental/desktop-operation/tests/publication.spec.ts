/**
 * Roster publication through the real agent-preset registry.
 * The card function is the real presetDisplayText. Named presets are not locale keys.
 */
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import { presetDisplayText, type PresetDisplaySource } from '@deepseek-ai/dsh-agent-preset-registry/display'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { desktopOperationCopy } from '../src/copy.ts'
import { apply, assertStatusTimeoutMs, Config } from '../src/index.ts'
import { desktopOperationDescription, statusProbe } from '../src/refusal.ts'
import { resolveAppDataDirectory } from '../src/state-directory.ts'

const READY = '在这台 Mac 上观察并操作桌面应用。同一时间只有一个桌面操作会话。'
const DENIED = JSON.stringify({ data: { permissions: { screen_recording: { state: 'denied' } } } })
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

describe('desktop-operation roster publication', () => {
  it('publishes the platform sentence on an unsupported host', async () => {
    const ctx = await registry()
    const description = desktopOperationDescription({ platform: 'linux', arch: 'arm64', fallback: READY, probe: 'ready' })
    await ctx.agentPresets.register({
      id: 'desktop-operation',
      name: '桌面操作',
      description,
      listed: true,
      plugins: [],
    })
    const row = (await ctx.agentPresets.list()).find(item => item.id === 'desktop-operation')
    expect(row?.description).toBe(desktopOperationCopy.zh.platformUnsupported)
    expect(presetDisplayText(
      displaySource(row?.name ?? '桌面操作', row?.description),
      () => 'built-in',
    ).description).toBe(desktopOperationCopy.zh.platformUnsupported)
  })

  it('publishes the denial sentence from a synthetic status payload', async () => {
    const ctx = await registry()
    const description = desktopOperationDescription({
      platform: 'darwin', arch: 'arm64', fallback: READY, probe: 'denied',
    })
    await ctx.agentPresets.register({
      id: 'desktop-operation',
      name: '桌面操作',
      description,
      listed: true,
      plugins: [],
    })
    const row = (await ctx.agentPresets.list()).find(item => item.id === 'desktop-operation')
    expect(row?.description).toBe(desktopOperationCopy.zh.permissionDenied)
    expect(statusProbe(DENIED)).toBe('denied')
    expect(statusProbe(undefined)).toBe('unavailable')
    expect(statusProbe('not-json')).toBe('unavailable')
    expect(statusProbe('{}')).toBe('unavailable')
    expect(statusProbe(JSON.stringify({ error: 'status failed' }))).toBe('unavailable')
    expect(statusProbe(JSON.stringify({ data: { permissions: {} } }))).toBe('unavailable')
    expect(statusProbe(JSON.stringify({ data: { permissions: [] } }))).toBe('unavailable')
    expect(statusProbe(JSON.stringify({ data: { permissions: { screen: { state: 1 } } } }))).toBe('unavailable')
    expect(statusProbe(JSON.stringify({ data: { permissions: { screen: { state: 'unknown' } } } }))).toBe('ready')
    expect(desktopOperationDescription({
      platform: 'darwin', arch: 'arm64', fallback: READY, probe: 'denied', locale: 'en',
    })).toBe(desktopOperationCopy.en.permissionDenied)
    expect(desktopOperationDescription({
      platform: 'darwin', arch: 'arm64', fallback: READY, probe: 'unavailable',
    })).toBe(desktopOperationCopy.zh.statusUnavailable)
  })

  it('publishes the platform sentence from apply when the host cannot spawn', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ad01-dsh-'))
    const previousHome = process.env.DSH_HOME
    const previousPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    process.env.DSH_HOME = home
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    const ctx = await registry()
    try {
      await apply(ctx, { appDataDirectory: '', assetDirectory: '', statusTimeoutMs: 500 })
      const row = (await ctx.agentPresets.list()).find(item => item.id === 'desktop-operation')
      expect(row?.description).toBe(desktopOperationCopy.zh.platformUnsupported)
    } finally {
      if (previousPlatform !== undefined) Object.defineProperty(process, 'platform', previousPlatform)
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(home, { recursive: true, force: true })
    }
  })

  it('keeps the denial sentence when preset activation fails', async () => {
    const ctx = await registry()
    const description = desktopOperationDescription({
      platform: 'darwin', arch: 'arm64', fallback: READY, probe: 'denied',
    })
    await ctx.agentPresets.register({
      id: 'desktop-operation',
      name: '桌面操作',
      description,
      listed: true,
      plugins: [{ name: 'missing-preset-plugin-for-ad01' }],
    })
    const row = (await ctx.agentPresets.list()).find(item => item.id === 'desktop-operation')
    expect(row?.description).toBe(desktopOperationCopy.zh.permissionDenied)
    expect(typeof row?.broken).toBe('string')
    expect((row?.broken ?? '').length > 0).toBe(true)
  })
})

const supported = process.platform === 'darwin' && process.arch === 'arm64'

describe('desktop-operation configuration', () => {
  it('rejects a nonpositive or overflowing status timeout and a relative app-data path', () => {
    const fields = { appDataDirectory: '', assetDirectory: '' }
    expect(() => Config({ ...fields, statusTimeoutMs: 0 })).toThrow()
    expect(() => Config({ ...fields, statusTimeoutMs: -1 })).toThrow()
    expect(() => Config({ ...fields, statusTimeoutMs: 1.5 })).toThrow()
    expect(() => Config({ ...fields, statusTimeoutMs: 2_147_483_648 })).toThrow()
    expect(Config({ ...fields, statusTimeoutMs: 1 }).statusTimeoutMs).toBe(1)
    expect(Config({ ...fields, statusTimeoutMs: 2_147_483_647 }).statusTimeoutMs).toBe(2_147_483_647)
    expect(Config({ ...fields, statusTimeoutMs: 5000 }).statusTimeoutMs).toBe(5000)
    expect(() =>{  assertStatusTimeoutMs(0) }).toThrow('statusTimeoutMs must be an integer from 1 to 2147483647')
    expect(() => resolveAppDataDirectory('relative/path', {})).toThrow('desktop-operation: appDataDirectory must be absolute')
    expect(() => resolveAppDataDirectory('', { OCTOPUS_APP_DATA: 'relative' })).toThrow('desktop-operation: OCTOPUS_APP_DATA must be absolute')
    expect(resolveAppDataDirectory('', {})).toBeUndefined()
  })
})

describe.skipIf(!supported)('status probe publishes through the roster', () => {
  it('publishes unavailable when status exceeds the timeout and the child is gone', async () => {
    const seen = await publish('#!/usr/bin/env node\nsetInterval(() => {}, 1e9)\n', 200)
    expect(seen.description).toBe(desktopOperationCopy.zh.statusUnavailable)
    expect(presetDisplayText(
      displaySource('桌面操作', seen.description),
      () => 'built-in',
    ).description).toBe(desktopOperationCopy.zh.statusUnavailable)
    expect(await pgrep(seen.binary)).toEqual([])
  })

  it('publishes unavailable for a corrupt payload and the packaged sentence after a granted payload', async () => {
    const corrupt = await publish('#!/bin/sh\nprintf \'not-json\\n\'\n', 5000)
    expect(corrupt.description).toBe(desktopOperationCopy.zh.statusUnavailable)
    expect(corrupt.composition).not.toContain('serverName: agent-desktop')
    const granted = '{"data":{"permissions":{"accessibility":{"state":"granted"},"automation":{"state":"unknown"}}}}'
    const ready = await publish(`#!/bin/sh\nprintf '%s\\n' '${granted}'\n`, 5000)
    expect(ready.description).toBe(READY)
    expect(ready.composition).not.toContain('dsh-mcp-client')
    expect(ready.composition).toContain("dshHomePath('.agent-presets', 'desktop-operation', 'skills')")
    expect(presetDisplayText(
      displaySource('桌面操作', ready.description),
      () => 'built-in',
    ).description).toBe(READY)
  })

  it('publishes unavailable when status JSON has no permission map, including an error envelope', async () => {
    const empty = await publish('#!/bin/sh\nprintf \'{}\\n\'\n', 5000)
    expect(empty.description).toBe(desktopOperationCopy.zh.statusUnavailable)
    const envelope = await publish('#!/bin/sh\nprintf \'%s\\n\' \'{"error":"status failed"}\'\n', 5000)
    expect(envelope.description).toBe(desktopOperationCopy.zh.statusUnavailable)
    const malformed = await publish('#!/bin/sh\nprintf \'%s\\n\' \'{"data":{"permissions":{"screen":{}}}}\'\n', 5000)
    expect(malformed.description).toBe(desktopOperationCopy.zh.statusUnavailable)
    const emptyMap = await publish('#!/bin/sh\nprintf \'%s\\n\' \'{"data":{"permissions":{}}}\'\n', 5000)
    expect(emptyMap.description).toBe(desktopOperationCopy.zh.statusUnavailable)
  })

  it('omits the description when metadata and a granted status leave it empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ad01-partial-'))
    const home = await mkdtemp(join(tmpdir(), 'ad01-dsh-'))
    const binary = join(dir, 'agent-desktop')
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const preset = join(home, '.agent-presets', 'desktop-operation')
    const ctx = await registry()
    try {
      await writeFile(binary, '#!/bin/sh\nprintf \'%s\\n\' \'{"data":{"permissions":{"accessibility":{"state":"granted"}}}}\'\n')
      await chmod(binary, 0o755)
      await writeFile(join(dir, 'agent-desktop-macos-helper'), '')
      await mkdir(preset, { recursive: true })
      await writeFile(join(preset, 'preset.yml'), '{}\n')
      await writeFile(join(preset, 'agent.cordis.yml'), "- name: '@deepseek-ai/dsh-mcp-client'\n  config:\n    toolCallTimeoutMs: 60000\n")
      await apply(ctx, { appDataDirectory: dir, assetDirectory: dir, statusTimeoutMs: 5000 })
      const row = (await ctx.agentPresets.list()).find(item => item.id === 'desktop-operation')
      expect(row?.name).toBe('桌面操作')
      expect(row?.description).toBeUndefined()
      expect(row?.order).toBe(40)
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(dir, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  })

  it('publishes unavailable when app data is unset and rejects a relative app-data path', async () => {
    const previous = process.env.OCTOPUS_APP_DATA
    delete process.env.OCTOPUS_APP_DATA
    const home = await mkdtemp(join(tmpdir(), 'ad01-home-'))
    const assets = await mkdtemp(join(tmpdir(), 'ad01-assets-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = await registry()
    try {
      await apply(ctx, { appDataDirectory: '', assetDirectory: assets, statusTimeoutMs: 5000 })
      const row = (await ctx.agentPresets.list()).find(item => item.id === 'desktop-operation')
      expect(row?.description).toBe(desktopOperationCopy.zh.statusUnavailable)
      await expect(apply(ctx, { appDataDirectory: 'relative/path', assetDirectory: assets, statusTimeoutMs: 5000 }))
        .rejects.toThrow('desktop-operation: appDataDirectory must be absolute')
    } finally {
      if (previous === undefined) delete process.env.OCTOPUS_APP_DATA
      else process.env.OCTOPUS_APP_DATA = previous
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(home, { recursive: true, force: true })
      await rm(assets, { recursive: true, force: true })
    }
  })
})

async function publish(
  body: string,
  statusTimeoutMs: number,
): Promise<{ description: string | undefined; binary: string; composition: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'ad01-status-'))
  const home = await mkdtemp(join(tmpdir(), 'ad01-dsh-'))
  const binary = join(dir, 'agent-desktop')
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const ctx = await registry()
  try {
    await writeFile(binary, body)
    await chmod(binary, 0o755)
    await apply(ctx, {
      appDataDirectory: dir,
      assetDirectory: dir,
      statusTimeoutMs,
    })
    const row = (await ctx.agentPresets.list()).find(item => item.id === 'desktop-operation')
    const document = await ctx.agentPresets.readDocument('desktop-operation')
    return { description: row?.description, binary, composition: document.content }
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(dir, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  }
}

function pgrep(text: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile('pgrep', ['-f', text], (error, stdout) => {
      if (error !== null && error.code === 1) { resolve([]); return }
      if (error !== null) { reject(error instanceof Error ? error : new Error(error.message, { cause: error })); return }
      resolve(stdout.split('\n').filter(line => line !== ''))
    })
  })
}

function displaySource(name: string, description: string | undefined): PresetDisplaySource {
  return {
    id: 'desktop-operation',
    name,
    ...description === undefined ? {} : { description },
  }
}

async function registry(): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = import.meta.url
  contexts.push(ctx)
  await ctx.plugin(Loader)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentPresets, { default: 'standard' })
  return ctx
}
