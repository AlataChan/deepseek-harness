/**
 * @deepseek-ai/dsh-client-connection-process — bounded process-carrier protocol and companion gateway.
 * @module @deepseek-ai/dsh-client-connection-process
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-modules'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-api-gateway'
import { CLAIMED_STDIO_GLOBAL } from './claim-process-stdio.ts'
import { VsCodeHostGateway } from './host-gateway.ts'
import { ProcessIpcPort, VsCodeIpcChannel, type NodeIpcPort } from './ipc-channel.ts'
import { DEFAULT_MAX_LOGICAL_RPC_BYTES } from './protocol.ts'

export * from './claim-process-stdio.ts'
export * from './codec.ts'
export * from './host-gateway.ts'
export * from './ipc-channel.ts'
export * from './protocol.ts'
export * from './stdio-line-port.ts'

/** Services required by the companion gateway. */
export const inject = ['connection', 'clientModules', 'typertGateway']

/** Companion carrier configuration. */
export interface Config {
  /** Maximum logical bytes accepted for RPC and stream-data frames. */
  maxLogicalRpcBytes?: number
  /** Workspace root the handshake must repeat exactly after path normalization. */
  workspaceRoot?: string
}

/** Validated companion carrier configuration. */
export const Config: z<Config> = z.object({
  maxLogicalRpcBytes: z.natural().min(1).default(DEFAULT_MAX_LOGICAL_RPC_BYTES),
  workspaceRoot: z.string(),
})

function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(
    fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8',
  )) as { version?: unknown }
  /* v8 ignore next -- the checked-in package manifest is validated to contain a string version. */
  if (typeof manifest.version !== 'string') throw new Error('connection-process package version is missing')
  return manifest.version
}

/** Injectable process facts used by tests and the published companion entry. */
export interface CompanionRuntimePorts {
  /** Connected Node IPC port; absent selects the current process channel. */
  port?: NodeIpcPort
  /** Workspace selected by the launcher; absent uses configured root, then `process.cwd()`. */
  workspaceRoot?: string
  /** Installed runtime version; absent reads this package's manifest. */
  runtimeVersion?: string
}

/**
 * Mount one process-IPC companion gateway and bind its drain to the plugin fiber.
 * @param ctx - Host context carrying Connection, Client modules, and the Typert gateway.
 * @param config - validated carrier capacity.
 * @param runtime - injectable process facts; Cordis callers omit this parameter.
 */
export function apply(ctx: Context, config: Config, runtime: CompanionRuntimePorts = {}): void {
  const maxLogicalRpcBytes = config.maxLogicalRpcBytes as number
  const published = Reflect.get(globalThis, CLAIMED_STDIO_GLOBAL) as NodeIpcPort | undefined
  const port = runtime.port ?? published ?? new ProcessIpcPort()
  if (!port.connected) throw new Error('desktop companion requires a connected Node IPC channel')
  const channelReady = Promise.withResolvers<VsCodeIpcChannel>()
  const gateway = new VsCodeHostGateway({
    apiFetchHandler: ctx.connection.createSharedFetchHandler('/api'),
    openStream: (endpoint, payload, signal) => ctx.typertGateway.wireStream.open(endpoint, payload, signal),
    clientModules: ctx.clientModules,
    expectedWorkspaceRoot: runtime.workspaceRoot ?? config.workspaceRoot ?? process.cwd(),
    runtimeVersion: runtime.runtimeVersion ?? packageVersion(),
    maxLogicalRpcBytes,
    send: frame => channelReady.promise.then(channel => channel.send(frame)),
    close: () => {
      queueMicrotask(() => { void channelReady.promise.then(channel => channel.dispose()) })
    },
  })
  const channel = new VsCodeIpcChannel({
    port,
    maxLogicalRpcBytes,
    onFrame: frame => gateway.accept(frame),
    onFailure: () => { void gateway.dispose() },
    onDisconnect: () => { void gateway.dispose() },
  })
  channelReady.resolve(channel)
  ctx.effect(() => async () => {
    await Promise.all([gateway.dispose(), channel.dispose()])
  }, 'client-connection-process: drain gateway and IPC channel')
}
