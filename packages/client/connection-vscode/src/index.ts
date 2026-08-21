/**
 * @deepseek-ai/dsh-client-connection-vscode — bounded protocol and companion gateway.
 * @module @deepseek-ai/dsh-client-connection-vscode
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-client-modules'
import type {} from '@deepseek-ai/dsh-host-apiproxy'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { DEFAULT_MAX_REQUEST_BODY_BYTES } from '@deepseek-ai/dsh-client-connection/body-capacity'
import { VsCodeHostGateway } from './host-gateway.ts'
import { ProcessIpcPort, VsCodeIpcChannel, type NodeIpcPort } from './ipc-channel.ts'

export * from './codec.ts'
export * from './host-gateway.ts'
export * from './ipc-channel.ts'
export * from './protocol.ts'

/** Stable Cordis plugin name. */
export const name = 'client-connection-vscode'

/** Services required by the companion gateway. */
export const inject = ['apiProxy', 'clientModules']

/** Companion carrier configuration. */
export interface Config {
  /** Maximum logical bytes accepted for RPC and stream-data frames. */
  maxLogicalRpcBytes?: number
  /** Workspace root the extension handshake must repeat exactly after path normalization. */
  workspaceRoot?: string
}

/** Validated companion carrier configuration. */
export const Config: z<Config> = z.object({
  maxLogicalRpcBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
  workspaceRoot: z.string(),
})

function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(
    fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8',
  )) as { version?: unknown }
  /* v8 ignore next -- the checked-in package manifest is validated to contain a string version. */
  if (typeof manifest.version !== 'string') throw new Error('connection-vscode package version is missing')
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
 * @param ctx - Host context carrying ApiProxy and the Client Plugin registry.
 * @param config - validated carrier capacity.
 * @param runtime - injectable process facts; Cordis callers omit this parameter.
 */
export function apply(ctx: Context, config: Config, runtime: CompanionRuntimePorts = {}): void {
  const maxLogicalRpcBytes = config.maxLogicalRpcBytes as number
  const port = runtime.port ?? new ProcessIpcPort()
  if (!port.connected) throw new Error('vscode companion requires a connected Node IPC channel')
  const connection = new HostConnectionService(ctx, [])
  const channelReady = Promise.withResolvers<VsCodeIpcChannel>()
  const gateway = new VsCodeHostGateway({
    apiProxy: ctx.apiProxy,
    apiFetchHandler: connection.createSharedFetchHandler('/api', toFetchHandler(ctx.apiProxy)),
    clientModules: ctx.clientModules,
    imageCapacitySource: ctx,
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
  }, 'client-connection-vscode: drain gateway and IPC channel')
}
