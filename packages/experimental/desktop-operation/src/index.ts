/**
 * Register the desktop-operation preset.
 * The shared preset tree does not start the MCP server. Each matching Agent starts its own.
 * This plugin does not insert an MCP client at the profile root.
 * @module @deepseek-ai/dsh-experimental-desktop-operation
 */

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { resolveNativeAssets } from './assets.ts'
import { isDesktopOperationPlatform } from './platform.ts'
import { desktopOperationDescription, statusProbe } from './refusal.ts'
import {
  compositionPath,
  composePresetPlugins,
  desktopMcpLaunch,
  DESKTOP_OPERATION_PRESET_ID,
  type DesktopMcpLaunch,
  installDesktopOperationPreset,
  readComposition,
  readPresetMetadata,
  supervisorProgram,
} from './preset.ts'
import { lockFilePath, resolveAppDataDirectory, stateDirectory } from './state-directory.ts'

/** Loader-facing plugin name. */
export const name = 'desktop-operation'

/** Roster registration needs the preset registry. */
export const inject = ['agentPresets']

/** Validated plugin configuration. */
export interface Config {
  /** Absolute app-data directory. Empty uses `OCTOPUS_APP_DATA` when that value is absolute. */
  appDataDirectory: string
  /** Absolute native asset directory. Empty uses `../native` beside this plugin. */
  assetDirectory: string
  /** How long to wait for `agent-desktop status` before publishing the unavailable sentence. */
  statusTimeoutMs: number
}

/** Largest delay `setTimeout` accepts without overflowing a 32-bit signed integer. */
const MAX_STATUS_TIMEOUT_MS = 2_147_483_647

/**
 * Reject a timeout `setTimeout` would clamp, overflow, or fire immediately.
 * @param timeoutMs - candidate `statusTimeoutMs`.
 * @throws {Error} when the value is not an integer from 1 through {@link MAX_STATUS_TIMEOUT_MS}.
 */
export function assertStatusTimeoutMs(timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_STATUS_TIMEOUT_MS) {
    throw new Error(`desktop-operation: statusTimeoutMs must be an integer from 1 to ${MAX_STATUS_TIMEOUT_MS}`)
  }
}

/** Plugin configuration. Empty strings select the runtime defaults. */
export const Config: z<Config> = z.object({
  appDataDirectory: z.string().default(''),
  assetDirectory: z.string().default(''),
  statusTimeoutMs: z.number().step(1).min(1).max(MAX_STATUS_TIMEOUT_MS).default(5000),
})

/**
 * Install the preset and register it on the roster.
 * A supported host may run `agent-desktop status` once. An unsupported host does not spawn.
 * @param ctx - host context holding the preset roster.
 * @param config - app-data and asset directories.
 * @returns when the roster entry is registered.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const target = dshHomePath('.agent-presets', DESKTOP_OPERATION_PRESET_ID)
  await installDesktopOperationPreset(import.meta.url, target)
  const metadata = await readPresetMetadata(`${target}/preset.yml`)
  const rows = readComposition(await readFile(compositionPath(target), 'utf8'))
  const assets = resolveNativeAssets(config.assetDirectory, import.meta.url)
  assertStatusTimeoutMs(config.statusTimeoutMs)
  const appData = resolveAppDataDirectory(config.appDataDirectory, process.env)
  const supported = isDesktopOperationPlatform(process.platform, process.arch)
  const probe = supported && appData !== undefined
    ? await probeDesktopStatus(assets.binary, stateDirectory(appData), assets.helper, config.statusTimeoutMs)
    : supported ? 'unavailable' : 'ready'
  const fallback = metadata.description ?? ''
  const description = desktopOperationDescription({
    platform: process.platform,
    arch: process.arch,
    fallback,
    probe,
  })
  const launchInput = {
    platform: process.platform,
    arch: process.arch,
    home: appData === undefined ? '' : stateDirectory(appData),
    lockPath: appData === undefined ? '' : lockFilePath(appData),
    binary: assets.binary,
    helper: assets.helper,
    supervisor: supervisorProgram(import.meta.url),
    node: process.execPath,
  }
  const plugins = composePresetPlugins(rows)
  bindDesktopAgents(ctx, desktopMcpLaunch(launchInput, rows))
  const unregister = await ctx.agentPresets.register({
    id: DESKTOP_OPERATION_PRESET_ID,
    name: metadata.name ?? '桌面操作',
    ...description === '' ? {} : { description },
    order: metadata.order ?? 40,
    listed: true,
    plugins,
  })
  ctx.effect(() => unregister, 'desktop-operation.definition')
}

/**
 * Start one MCP client when an Agent selects this preset.
 * The listener and the clients it starts are effects of `ctx`. Unloading `ctx`
 * disposes every client still recorded for this call, including one whose
 * startup has not finished. Process and lock release finish inside that
 * disposal. A later disposal of an older Agent removes only the client this
 * call recorded for that Agent.
 * @param ctx - host context that receives `agent/created`.
 * @param launch - per-Agent stdio launch, or undefined on an unsupported host.
 * @returns nothing. The registration stays until `ctx` unloads.
 */
export function bindDesktopAgents(ctx: Context, launch: DesktopMcpLaunch | undefined): void {
  ctx.effect(() => {
    const clients = new Map<Agent, { dispose(): void | Promise<void> }>()
    const stop = ctx.on('agent/created', async ({ agent }) => {
      if (launch === undefined) return
      if (ctx.agentPresets.composedPreset(agent.ctx) !== DESKTOP_OPERATION_PRESET_ID) return
      const fiber = agent.ctx.plugin(McpClient, McpClient.Config({
        transport: launch.transport,
        serverName: launch.serverName,
        command: launch.command,
        args: [...launch.args],
        env: { ...launch.env },
        cwd: launch.cwd,
        ...launch.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: launch.toolCallTimeoutMs },
        failOnStartupError: launch.failOnStartupError,
        reconnect: { enabled: false },
      }))
      clients.set(agent, fiber)
      agent.ctx.effect(() => () => {
        if (clients.get(agent) === fiber) clients.delete(agent)
      })
      await fiber
    })
    return async () => {
      stop()
      const pending = [...clients.values()]
      clients.clear()
      await Promise.all(pending.map(client => Promise.resolve(client.dispose())))
    }
  }, 'desktop-operation.agents')
}

/**
 * Run `agent-desktop status` and classify the payload.
 * A missing binary, empty output, corrupt JSON, or timeout is `unavailable`.
 * @param binary - pinned executable.
 * @param home - absolute `AGENT_DESKTOP_HOME`.
 * @param helper - pinned helper.
 * @param timeoutMs - validated `statusTimeoutMs`.
 * @returns the probe the roster description uses.
 */
export async function probeDesktopStatus(binary: string, home: string, helper: string, timeoutMs: number): Promise<'ready' | 'denied' | 'unavailable'> {
  assertStatusTimeoutMs(timeoutMs)
  return statusProbe(await readStatus(binary, home, helper, timeoutMs))
}

/**
 * Run `agent-desktop status` and return stdout after the process has exited.
 * A timeout kills the child and waits for that exit before returning.
 * Spawn failure has no child to wait for.
 * @param binary - pinned executable.
 * @param home - absolute `AGENT_DESKTOP_HOME`.
 * @param helper - pinned helper.
 * @param timeoutMs - validated `statusTimeoutMs`.
 * @returns stdout, or undefined when status is missing, empty, or timed out.
 */
function readStatus(binary: string, home: string, helper: string, timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(binary, ['status'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: {
        ...process.env,
        AGENT_DESKTOP_HOME: home,
        AGENT_DESKTOP_MACOS_HELPER_PATH: helper,
      },
    })
    const chunks: Buffer[] = []
    let settled = false
    let timedOut = false
    const onData = (chunk: Buffer): void => { chunks.push(chunk) }
    child.stdout.on('data', onData)
    const finish = (stdout: string | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout.off('data', onData)
      child.off('error', onError)
      child.off('exit', onExit)
      resolve(stdout)
    }
    const onError = (): void => { finish(undefined) }
    const onExit = (): void => {
      if (timedOut) { finish(undefined); return }
      const stdout = Buffer.concat(chunks).toString('utf8')
      finish(stdout.trim() === '' ? undefined : stdout)
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
      if (child.exitCode !== null || child.signalCode !== null) onExit()
    }, timeoutMs)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}
