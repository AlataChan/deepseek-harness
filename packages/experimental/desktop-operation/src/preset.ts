/**
 * Install the desktop-operation preset.
 * The shared preset tree does not start the MCP server. Each Agent starts its own.
 * @module @deepseek-ai/dsh-experimental-desktop-operation/preset
 */

import { access, cp, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { entryListProblem } from '@deepseek-ai/dsh-agent-preset-registry'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { load } from 'js-yaml'
import { isDesktopOperationPlatform } from './platform.ts'

/** Preset id registered on the roster. */
export const DESKTOP_OPERATION_PRESET_ID = 'desktop-operation'

const MCP_CLIENT = '@deepseek-ai/dsh-mcp-client'

/** Values the registrar writes into the single MCP row on a supported host. */
export interface ComposeInput {
  /** Host platform. */
  readonly platform: NodeJS.Platform
  /** Host architecture. */
  readonly arch: string
  /** Absolute state directory, or empty when app data is missing. */
  readonly home: string
  /** Absolute lock file, or empty when app data is missing. */
  readonly lockPath: string
  /** Pinned executable. */
  readonly binary: string
  /** Pinned helper. */
  readonly helper: string
  /** Supervisor program the MCP row runs under Node. */
  readonly supervisor: string
  /** Node executable. The CLI and the host both use `process.execPath`. */
  readonly node: string
}

/**
 * Locate the packaged preset directory.
 * @param moduleUrl - `import.meta.url` of the module that sits beside `preset/`.
 * @returns absolute preset directory.
 */
export function packagedPresetDirectory(moduleUrl: string): string {
  return fileURLToPath(new URL('../preset/desktop-operation/', moduleUrl))
}

/**
 * Locate the supervisor program beside the host module.
 * A built plugin uses `supervisor.js`. Source tests use `supervisor.ts`.
 * @param moduleUrl - `import.meta.url` of the host entry.
 * @returns absolute supervisor path.
 */
export function supervisorProgram(moduleUrl: string): string {
  const built = fileURLToPath(new URL('./supervisor.js', moduleUrl))
  if (existsSync(built)) return built
  return fileURLToPath(new URL('./supervisor.ts', moduleUrl))
}

/**
 * Copy the packaged preset when the destination is absent.
 * An existing directory is left in place.
 * @param moduleUrl - module URL used to find the packaged preset.
 * @param target - destination directory.
 * @returns when the destination exists.
 */
export async function installDesktopOperationPreset(moduleUrl: string, target: string): Promise<void> {
  try {
    await access(target)
  } catch (error: unknown) {
    if (errorCode(error) !== 'ENOENT') throw error
    await mkdir(dirname(target), { recursive: true })
    await cp(packagedPresetDirectory(moduleUrl), target, { recursive: true })
  }
}

/**
 * Read the packaged display metadata.
 * @param file - `preset.yml` path.
 * @returns name, description, and order when they are the expected types.
 */
export async function readPresetMetadata(file: string): Promise<{ name?: string; description?: string; order?: number }> {
  const parsed: unknown = load(await readFile(file, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null) return {}
  const name = valueAt(parsed, 'name')
  const description = valueAt(parsed, 'description')
  const order = valueAt(parsed, 'order')
  return {
    ...typeof name === 'string' ? { name } : {},
    ...typeof description === 'string' ? { description } : {},
    ...typeof order === 'number' ? { order } : {},
  }
}

/**
 * Parse a preset composition.
 * @param text - `agent.cordis.yml` text.
 * @returns the plugin rows.
 * @throws {Error} when the document is not a valid entry list.
 */
export function readComposition(text: string): PresetDefinition['plugins'] {
  const parsed: unknown = load(text, { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error('desktop-operation: preset composition must be a list')
  const problem = entryListProblem(parsed)
  if (problem !== undefined) throw new Error(`desktop-operation: ${problem}`)
  return parsed as PresetDefinition['plugins']
}

/**
 * Drop every MCP row. The roster tree stays shared, so it must not start a server.
 * @param rows - packaged composition.
 * @returns the composition passed to the roster.
 * @throws {Error} when the composition names a computer-use plugin.
 */
export function composePresetPlugins(rows: PresetDefinition['plugins']): PresetDefinition['plugins'] {
  const names: string[] = []
  collectNames(rows, names)
  if (names.some(name => name.includes('computer-use'))) {
    throw new Error('desktop-operation: computer-use cannot share this preset')
  }
  return rows.filter(row => row.name !== MCP_CLIENT)
}

/** Stdio launch one Agent uses for its own agent-desktop client. */
export interface DesktopMcpLaunch {
  /** Child-process transport. */
  readonly transport: 'stdio'
  /** Tool namespace. One live Agent may reuse it after the previous Agent is gone. */
  readonly serverName: 'agent-desktop'
  /** Node executable. */
  readonly command: string
  /** Supervisor invocation, including the lock and the child command. */
  readonly args: readonly string[]
  /** State directory and helper path. */
  readonly env: Readonly<Record<string, string>>
  /** Working directory. Empty leaves the client default. */
  readonly cwd: ''
  /** Packaged call timeout, when the preset row set one. */
  readonly toolCallTimeoutMs?: number
  /** A failed lock or handshake fails this Agent's creation. */
  readonly failOnStartupError: true
  /** The client does not respawn a crashed server. */
  readonly reconnect: { readonly enabled: false }
}

/**
 * Build the per-Agent MCP launch.
 * An unsupported host returns undefined and spawns nothing. A supported host
 * still returns a launch when the lock path is empty, so that Agent fails
 * instead of sharing a server.
 * @param input - command, lock, and asset paths.
 * @param rows - packaged composition, read only for `toolCallTimeoutMs`.
 * @returns the launch, or undefined when this host cannot spawn.
 */
export function desktopMcpLaunch(input: ComposeInput, rows: PresetDefinition['plugins']): DesktopMcpLaunch | undefined {
  if (!isDesktopOperationPlatform(input.platform, input.arch)) return undefined
  const timeout = toolCallTimeoutMs(rows)
  return {
    transport: 'stdio',
    serverName: 'agent-desktop',
    command: input.node,
    args: [input.supervisor, '--lock', input.lockPath, '--binary', input.binary, '--', 'mcp'],
    env: {
      AGENT_DESKTOP_HOME: input.home,
      AGENT_DESKTOP_MACOS_HELPER_PATH: input.helper,
    },
    cwd: '',
    ...timeout === undefined ? {} : { toolCallTimeoutMs: timeout },
    failOnStartupError: true,
    reconnect: { enabled: false },
  }
}

/**
 * Keep the packaged MCP row's call timeout.
 * A missing value is left unset so the mcp-client schema owns the default.
 * @param rows - packaged composition, including the placeholder MCP row.
 * @returns the packaged timeout, or undefined when the row does not set one.
 */
function toolCallTimeoutMs(rows: PresetDefinition['plugins']): number | undefined {
  const row = rows.find(candidate => candidate.name === MCP_CLIENT)
  const config: unknown = row?.config
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return undefined
  const timeout = valueAt(config, 'toolCallTimeoutMs')
  return typeof timeout === 'number' ? timeout : undefined
}

function collectNames(rows: readonly unknown[], names: string[]): void {
  for (const row of rows) {
    if (typeof row !== 'object' || row === null || !('name' in row)) continue
    if (typeof row.name === 'string') names.push(row.name)
    if ('config' in row && Array.isArray(row.config)) collectNames(row.config, names)
  }
}

function valueAt(record: object, key: string): unknown {
  if (!Object.hasOwn(record, key)) return undefined
  return Object.getOwnPropertyDescriptor(record, key)?.value
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

/**
 * Packaged composition path inside an installed preset directory.
 * @param target - installed preset directory.
 * @returns the absolute composition filename.
 */
export function compositionPath(target: string): string {
  return join(target, 'agent.cordis.yml')
}
