/**
 * Status cancellation when the child is already reaped inside the timeout callback.
 * A second exit must not resolve the probe twice.
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { probeDesktopStatus } from '../src/index.ts'

const statusFault = vi.hoisted(() => ({ kind: 'reaped' as 'reaped' | 'empty' }))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn() {
      const stdout = new EventEmitter()
      const child = new EventEmitter()
      let exitCode: number | null = null
      let signalCode: NodeJS.Signals | null = null
      Object.defineProperty(child, 'stdout', { value: stdout })
      Object.defineProperty(child, 'exitCode', { get: () => exitCode })
      Object.defineProperty(child, 'signalCode', { get: () => signalCode })
      Object.defineProperty(child, 'kill', {
        value: (signal?: NodeJS.Signals) => {
          signalCode = signal ?? 'SIGTERM'
          exitCode = null
          child.emit('exit', null, signalCode)
          return true
        },
      })
      if (statusFault.kind === 'empty') queueMicrotask(() => { child.emit('exit', 0, null) })
      return child
    },
  }
})

describe('status probe cancellation', () => {
  it('treats a child that is already reaped at the timeout as unavailable once', async () => {
    statusFault.kind = 'reaped'
    const probe = probeDesktopStatus('/missing/agent-desktop', '/tmp/agent-desktop', '/missing/helper', 20)
    await expect(probe).resolves.toBe('unavailable')
  })

  it('treats empty stdout as unavailable', async () => {
    statusFault.kind = 'empty'
    const probe = probeDesktopStatus('/missing/agent-desktop', '/tmp/agent-desktop', '/missing/helper', 1000)
    await expect(probe).resolves.toBe('unavailable')
  })
})
