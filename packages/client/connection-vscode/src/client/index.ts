/** VS Code Webview Client Plugin providing the shared Connection service. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createConnectionHandle } from '@deepseek-ai/dsh-client-connection/client-shared'
import {
  DEFAULT_VSCODE_MAX_OPEN_STREAMS,
  DEFAULT_VSCODE_MAX_PENDING_REQUESTS,
  DEFAULT_VSCODE_RESPONSE_TIMEOUT_MS,
  VsCodeApiClient,
} from './api-client.ts'

export * from './api-client.ts'
export * from './bridge-port.ts'

/** Private shell services required before the connection plugin activates. */
export const inject = ['vscodeBridge', 'vscodeIde']

/** Webview connection tunables. */
export interface Config {
  /** Unary response deadline in milliseconds. */
  responseTimeoutMs?: number
  /** Maximum simultaneous response correlations. */
  maxPendingRequests?: number
  /** Maximum streams retained until terminal acknowledgement. */
  maxOpenStreams?: number
}

/** Validated Webview connection configuration. */
export const Config: z<Config> = z.object({
  responseTimeoutMs: z.natural().min(1).default(DEFAULT_VSCODE_RESPONSE_TIMEOUT_MS),
  maxPendingRequests: z.natural().min(1).default(DEFAULT_VSCODE_MAX_PENDING_REQUESTS),
  maxOpenStreams: z.natural().min(1).default(DEFAULT_VSCODE_MAX_OPEN_STREAMS),
})

/**
 * Publish the VS Code carrier through the standard Client Connection service.
 * @param ctx - Client context carrying the shell-provided private bridge.
 * @param config - validated response and concurrency bounds.
 */
export function apply(ctx: Context, config: Config): void {
  const port = ctx.get('vscodeBridge')
  if (port === undefined) throw new Error('client-connection-vscode: vscodeBridge service is missing')
  const ide = ctx.get('vscodeIde')
  if (ide === undefined) throw new Error('client-connection-vscode: vscodeIde service is missing')
  const api = new VsCodeApiClient(port, config, ide)
  ctx.provide('connection', createConnectionHandle({
    api,
    rpc: api.rpc,
    isLoopback: true,
    logPrefix: '[vscode-runtime]',
  }))
  ctx.effect(() => () => { api.dispose() }, 'client-connection-vscode: dispose Webview bridge')
}
