/** Transport-independent browser ConnectionHandle construction. */

import type { HostDescription, IApiClient } from './api.ts'
import {
  ConnectionController,
  type ConnectionConfig,
  type ConnectionSinks,
  type ConnectionState,
} from './connection.ts'
import type { ClientConnectionRpc } from '../rpc.ts'

/** Observable Host description published by each completed connection handshake. */
export interface HostDescriptionSource {
  /** Latest connected-generation description; absent before connect and while reconnecting. */
  getSnapshot(): HostDescription | undefined
  /** Subscribe to description replacement and connection loss. */
  subscribe(listener: () => void): () => void
}

/** Browser-side connection service shared by Web and embedded editor surfaces. */
export interface ConnectionHandle {
  /** Shared API client selected by the surface plugin. */
  readonly api: IApiClient
  /** Whether the current surface has loopback-equivalent Host trust. */
  readonly isLoopback: boolean
  /** Generation-scoped Host facts, including native path-open capability. */
  readonly hostDescription: HostDescriptionSource
  /** Generic logical RPC channels over the same Connection transport. */
  readonly rpc: ClientConnectionRpc
  /**
   * Start the connect/pump/reconnect loop with the consumer's frame sinks.
   * @param sinks - frame/state callbacks.
   * @param config - reconnect/backoff tunables.
   * @returns stop handle for the single owned loop.
   */
  start(sinks: ConnectionSinks, config?: ConnectionConfig): { stop(): void }
}

/** Inputs selected by one browser surface before publishing a connection handle. */
export interface ConnectionHandleOptions {
  /** API carrier for unary and event-stream methods. */
  api: IApiClient
  /** Generic logical RPC carrier. */
  rpc: ClientConnectionRpc
  /** Surface trust fact exposed to Client plugins. */
  isLoopback: boolean
  /** Prefix used when an isolated description subscriber throws. */
  logPrefix: string
}

/**
 * Construct the one-owner connection handle used by every browser surface.
 * @param options - selected carriers, trust fact, and diagnostic prefix.
 * @returns a fresh handle whose stream loop has not started.
 */
export function createConnectionHandle(options: ConnectionHandleOptions): ConnectionHandle {
  let started = false
  let description: HostDescription | undefined
  const descriptionListeners = new Set<() => void>()
  const publishDescription = (next: HostDescription | undefined): void => {
    if (Object.is(description, next)) return
    description = next
    for (const listener of [...descriptionListeners]) {
      try {
        listener()
      } catch (error) {
        console.error(`${options.logPrefix} host-description listener threw:`, error)
      }
    }
  }
  return {
    api: options.api,
    isLoopback: options.isLoopback,
    hostDescription: {
      getSnapshot: () => description,
      subscribe: (listener) => {
        descriptionListeners.add(listener)
        return () => { descriptionListeners.delete(listener) }
      },
    },
    rpc: options.rpc,
    start(sinks, config) {
      if (started) throw new Error('connection: the stream loop is already owned by another consumer')
      started = true
      const controller = new ConnectionController(options.api, {
        ...sinks,
        onConnected: (next) => {
          publishDescription(next)
          if (!Object.is(description, next)) return
          sinks.onConnected?.(next)
        },
        onStateChange: (state) => {
          if (state === 'reconnecting') publishDescription(undefined)
          sinks.onStateChange?.(state)
        },
      }, config ?? {})
      controller.start()
      return {
        stop: () => {
          controller.stop()
          publishDescription(undefined)
        },
      }
    },
  }
}

export type { ConnectionConfig, ConnectionSinks, ConnectionState, ClientConnectionRpc }
export { assertConnectionRpcTarget } from './rpc.ts'
