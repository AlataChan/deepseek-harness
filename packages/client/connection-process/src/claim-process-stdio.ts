/**
 * Process-wide claim of stdin/stdout as the companion record port.
 * @module @deepseek-ai/dsh-client-connection-process
 */

import { Writable } from 'node:stream'
import type { StdioLinePortStreams } from './stdio-line-port.ts'
import { StdioLinePort } from './stdio-line-port.ts'

interface ClaimedStdio {
  readonly port: StdioLinePort
  readonly restoreStdout?: () => void
}

/** Process-global key so an inlined Host copy can see the companion's claim. */
export const CLAIMED_STDIO_GLOBAL = '__dshClaimedStdio'

interface ClaimedStdioGlobal {
  [CLAIMED_STDIO_GLOBAL]: StdioLinePort | undefined
}

let claimed: ClaimedStdio | undefined

function claimedGlobal(): ClaimedStdioGlobal {
  return globalThis as typeof globalThis & ClaimedStdioGlobal
}

/**
 * Capture stdin/stdout once as the companion {@link StdioLinePort}.
 * A later `process.stdout.write` after a real-process claim is routed to stderr.
 * @param streams - test-injected streams; omitted claims the current process.
 * @returns the process-wide claimed port.
 */
export function claimProcessStdio(streams?: StdioLinePortStreams): StdioLinePort {
  if (claimed !== undefined || claimedGlobal()[CLAIMED_STDIO_GLOBAL] !== undefined) {
    throw new Error('process stdio already claimed')
  }
  if (streams !== undefined) {
    const port = new StdioLinePort(streams)
    claimed = { port }
    claimedGlobal()[CLAIMED_STDIO_GLOBAL] = port
    return port
  }
  const originalWrite = process.stdout.write.bind(process.stdout)
  const redirectWrite = (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean => {
    if (typeof encoding === 'function') return process.stderr.write(chunk, encoding)
    return process.stderr.write(chunk, encoding, callback)
  }
  process.stdout.write = redirectWrite
  const output = new Writable({
    write(chunk: string | Uint8Array, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
      originalWrite(chunk, encoding, callback)
    },
  })
  const port = new StdioLinePort({ input: process.stdin, output })
  claimed = {
    port,
    restoreStdout: () => { process.stdout.write = originalWrite },
  }
  claimedGlobal()[CLAIMED_STDIO_GLOBAL] = port
  return port
}

/**
 * Read the process-wide claimed stdio port, if one exists.
 * @returns the claimed port, or `undefined` when nobody has claimed.
 */
export function getClaimedStdioPort(): StdioLinePort | undefined {
  return claimedGlobal()[CLAIMED_STDIO_GLOBAL]
}

/**
 * Restore `process.stdout.write` and clear the claim so later tests see a clean process.
 */
export function resetClaimedStdioForTests(): void {
  claimed?.restoreStdout?.()
  const port = claimed?.port ?? claimedGlobal()[CLAIMED_STDIO_GLOBAL]
  port?.disconnect()
  claimed = undefined
  claimedGlobal()[CLAIMED_STDIO_GLOBAL] = undefined
}
