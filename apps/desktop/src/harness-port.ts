/** Invoke + Channel ports for the Tauri shell. */

/** Tagged downlink payload matching the Rust `DownlinkEvent` encoding. */
export type DesktopDownlinkEvent =
  | { event: 'record'; data: { line: string } }
  | { event: 'closed'; data: { reason: string } }
  | { event: 'child-exit'; data: { code: number | null } }

/** Commands the desktop WebView may invoke on the Rust shell. */
export interface DesktopShellPort {
  /**
   * Invoke one shell command.
   * @param cmd - registered command name.
   * @param args - camelCase arguments, including a Channel for `carrier_open`.
   * @returns the untrusted command result; parse it at the IPC boundary.
   */
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>
  /**
   * Allocate a downlink sink passed as `downlink` to `carrier_open`.
   * @param onEvent - tagged record and lifecycle events.
   * @returns the Channel object or harness token.
   */
  createChannel(onEvent: (event: DesktopDownlinkEvent) => void): unknown
}

/**
 * Bind the live Tauri IPC surface.
 * @returns a port that calls `@tauri-apps/api/core`.
 */
export async function createTauriShellPort(): Promise<DesktopShellPort> {
  const api = await import('@tauri-apps/api/core')
  return createTauriShellPortFromApi(api)
}

/**
 * Bind Tauri `invoke` and `Channel` after the API module is loaded.
 * @param api - `@tauri-apps/api/core` exports.
 * @returns a port for the packaged WebView.
 */
function createTauriShellPortFromApi(api: {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
  Channel: new () => { onmessage: ((event: DesktopDownlinkEvent) => void) | null }
}): DesktopShellPort {
  return {
    invoke: (cmd, args) => api.invoke(cmd, args),
    createChannel(onEvent) {
      const channel = new api.Channel()
      channel.onmessage = onEvent
      return channel
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw new Error(`${label}.${key} must be a string`)
  return value
}

function optionalString(record: Record<string, unknown>, key: string, label: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${label}.${key} must be a string`)
  return value
}

/**
 * Read optional string fields from a `runtime_configure` or `runtime_get_config` result.
 * @param value - untrusted invoke result.
 * @returns persisted Node, Harness, and workspace fields.
 */
export function parseRuntimeConfigFields(value: unknown): {
  nodePath?: string
  runtimePath?: string
  workspaceRoot?: string
} {
  if (!isRecord(value)) throw new Error('runtime config returned a non-object')
  const config: {
    nodePath?: string
    runtimePath?: string
    workspaceRoot?: string
  } = {}
  const nodePath = optionalString(value, 'nodePath', 'runtime config')
  const runtimePath = optionalString(value, 'runtimePath', 'runtime config')
  const workspaceRoot = optionalString(value, 'workspaceRoot', 'runtime config')
  if (nodePath !== undefined) config.nodePath = nodePath
  if (runtimePath !== undefined) config.runtimePath = runtimePath
  if (workspaceRoot !== undefined) config.workspaceRoot = workspaceRoot
  return config
}

/**
 * Read the fields announced by `runtime_resolve`.
 * @param value - untrusted invoke result.
 * @returns resolved companion paths and version.
 */
export function parseResolvedRuntimeState(value: unknown): {
  nodePath: string
  packageRoot: string
  companionEntry: string
  runtimeVersion: string
  discoveryPath: string
} {
  if (!isRecord(value)) throw new Error('runtime_resolve returned a non-object')
  return {
    nodePath: requiredString(value, 'nodePath', 'runtime_resolve'),
    packageRoot: requiredString(value, 'packageRoot', 'runtime_resolve'),
    companionEntry: requiredString(value, 'companionEntry', 'runtime_resolve'),
    runtimeVersion: requiredString(value, 'runtimeVersion', 'runtime_resolve'),
    discoveryPath: requiredString(value, 'discoveryPath', 'runtime_resolve'),
  }
}

/**
 * Read the fields announced by `carrier_open`.
 * @param value - untrusted invoke result.
 * @returns the opened generation and workspace.
 */
export function parseCarrierOpenState(value: unknown): {
  generationId: string
  runtimeVersion: string
  workspaceRoot: string
} {
  if (!isRecord(value)) throw new Error('carrier_open returned a non-object')
  return {
    generationId: requiredString(value, 'generationId', 'carrier_open'),
    runtimeVersion: requiredString(value, 'runtimeVersion', 'carrier_open'),
    workspaceRoot: requiredString(value, 'workspaceRoot', 'carrier_open'),
  }
}

/**
 * Read the fields announced by `cache_bundle`.
 * @param value - untrusted invoke result.
 * @returns rewritten src URL, destination, and allowed cache roots.
 */
export function parseCachedBundleState(value: unknown): {
  src: string
  destination: string
  generationDir: string
  allowed: string[]
} {
  if (!isRecord(value)) throw new Error('cache_bundle returned a non-object')
  const allowed = value.allowed
  if (!Array.isArray(allowed) || !allowed.every(item => typeof item === 'string')) {
    throw new Error('cache_bundle.allowed must be a string array')
  }
  return {
    src: requiredString(value, 'src', 'cache_bundle'),
    destination: requiredString(value, 'destination', 'cache_bundle'),
    generationDir: requiredString(value, 'generationDir', 'cache_bundle'),
    allowed,
  }
}
