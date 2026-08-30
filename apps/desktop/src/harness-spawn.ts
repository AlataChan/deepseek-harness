/** Node-only carrier-harness spawn used by assembled tests. */

import { type ChildProcess, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { DesktopDownlinkEvent, DesktopShellPort } from './harness-port.ts'

interface HarnessResponse {
  id?: number
  ok?: boolean
  result?: unknown
  error?: string
  event?: string
  data?: unknown
}

/**
 * Drive the `carrier-harness` binary over NDJSON.
 * @param child - spawned harness process with piped stdio.
 * @returns a shell port that shares the child's stdout events.
 */
export function createHarnessShellPort(child: ChildProcess): DesktopShellPort {
  if (child.stdin === null || child.stdout === null) {
    throw new Error('carrier-harness stdio was not piped')
  }
  const stdin = child.stdin
  const pending = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }>()
  const listeners = new Set<(event: DesktopDownlinkEvent) => void>()
  let nextId = 1
  const reader = createInterface({ input: child.stdout })
  reader.on('line', (line) => {
    if (line === '') return
    let parsed: HarnessResponse
    try {
      parsed = JSON.parse(line) as HarnessResponse
    } catch (error) {
      for (const waiter of pending.values()) {
        waiter.reject(error instanceof Error ? error : new Error(String(error)))
      }
      pending.clear()
      return
    }
    if (typeof parsed.event === 'string') {
      const event = parsed as DesktopDownlinkEvent
      for (const listener of listeners) listener(event)
      return
    }
    if (typeof parsed.id !== 'number') return
    const waiter = pending.get(parsed.id)
    if (waiter === undefined) return
    pending.delete(parsed.id)
    if (parsed.ok === true) waiter.resolve(parsed.result)
    else waiter.reject(new Error(parsed.error ?? 'carrier-harness command failed'))
  })
  child.on('exit', () => {
    const error = new Error('carrier-harness exited')
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
    reader.close()
  })
  return {
    invoke(cmd, args) {
      const id = nextId
      nextId += 1
      return new Promise<unknown>((resolve, reject) => {
        pending.set(id, {
          resolve,
          reject,
        })
        stdin.write(`${JSON.stringify({ id, cmd, args: args ?? {} })}\n`, (error) => {
          if (error !== null) {
            pending.delete(id)
            reject(error instanceof Error ? error : new Error(String(error)))
          }
        })
      })
    },
    createChannel(onEvent) {
      listeners.add(onEvent)
      return { kind: 'harness-downlink' }
    },
  }
}

/**
 * Spawn the carrier harness with isolated config, cache, and CLI paths.
 * @param options - binary, directories, and environment inherited by the companion child.
 * @returns the port, child, and a disposer that kills the harness.
 */
export function spawnCarrierHarness(options: {
  bin: string
  cwd: string
  home: string
  configDir: string
  cacheDir: string
  cliPath: string
  extraEnv?: NodeJS.ProcessEnv
}): { port: DesktopShellPort; child: ChildProcess; dispose: () => void } {
  const child = spawn(options.bin, [], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.extraEnv,
      DSH_DESKTOP_HARNESS_HOME: options.home,
      DSH_DESKTOP_HARNESS_CONFIG: options.configDir,
      DSH_DESKTOP_HARNESS_CACHE: options.cacheDir,
      DSH_DESKTOP_HARNESS_CLI: options.cliPath,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return {
    port: createHarnessShellPort(child),
    child,
    dispose() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    },
  }
}
