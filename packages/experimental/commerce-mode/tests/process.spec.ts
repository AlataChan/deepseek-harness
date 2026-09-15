/** Managed sqlite3 stdout stays bounded after termination starts. */

import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { runSqliteProcess } from '../src/provider/analysis.ts'

function lateEmittingContext(): { ctx: Context; stdout: PassThrough; lateReads: () => number } {
  const stdout = new PassThrough({ objectMode: true })
  const stderr = new PassThrough({ objectMode: true })
  let reads = 0
  const late = Buffer.alloc(64)
  Object.defineProperty(late, 'byteLength', { get: () => { reads += 1; return 64 } })
  let settle: (outcome: { exitCode: number | null; signal: string | null }) => void = () => undefined
  const done = new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => { settle = resolve })
  const handle = {
    stdout,
    stderr,
    done,
    waitForExit: () => Promise.resolve(),
    terminate: () => {
      stdout.write(late)
      setImmediate(() => { settle({ exitCode: null, signal: 'SIGTERM' }) })
    },
  }
  const ctx = {
    subprocess: {
      spawn: (options: { signal: AbortSignal }) => {
        options.signal.addEventListener('abort', () => { handle.terminate() }, { once: true })
        return handle
      },
    },
  } as unknown as Context
  return { ctx, stdout, lateReads: () => reads }
}

describe('sqlite3 process output bound', () => {
  it('discards stdout emitted after the output limit stops the process', async () => {
    const { ctx, stdout, lateReads } = lateEmittingContext()
    const run = runSqliteProcess(ctx, ['sqlite3'], '/', { maxRows: 1, maxOutputBytes: 8, timeoutMs: 5_000, graceMs: 10 })
    stdout.write(Buffer.alloc(16))
    await expect(run).rejects.toMatchObject({ code: 'analysis-output-too-large' })
    expect(lateReads()).toBe(0)
  })

  it('discards stdout emitted after the timeout stops the process', async () => {
    const { ctx, lateReads } = lateEmittingContext()
    await expect(runSqliteProcess(ctx, ['sqlite3'], '/', { maxRows: 1, maxOutputBytes: 1024, timeoutMs: 5, graceMs: 10 }))
      .rejects.toMatchObject({ code: 'analysis-timeout' })
    expect(lateReads()).toBe(0)
  })
})
