import { describe, expect, it, vi } from 'vitest'
import { createTuiShutdown } from '../src/driver/shutdown.ts'

function bench() {
  const order: string[] = []
  const step = (name: string) => vi.fn(async () => { order.push(name) })
  const rejectInput = vi.fn(() => { order.push('reject-input') })
  const requestExit = vi.fn((code: number) => { order.push(`exit:${code}`) })
  const shutdown = createTuiShutdown({
    rejectInput,
    settleInteractions: step('settle-interactions'),
    cancelAgent: vi.fn(() => { order.push('cancel-agent') }),
    whenIdle: step('when-idle'),
    flushSession: step('flush-session'),
    unmount: step('unmount'),
    restoreRawMode: vi.fn(() => { order.push('restore-raw') }),
    disposeOwned: step('dispose-owned'),
    requestExit,
  })
  return { order, shutdown, rejectInput, requestExit }
}

describe('tui ordered shutdown', () => {
  it('performs user shutdown in the required order and shares one Promise', async () => {
    const test = bench()
    const first = test.shutdown.shutdown('user')
    const second = test.shutdown.shutdown('user')
    expect(second).toBe(first)
    await first
    expect(test.order).toEqual([
      'reject-input', 'settle-interactions', 'cancel-agent', 'when-idle',
      'flush-session', 'unmount', 'restore-raw', 'dispose-owned', 'exit:0',
    ])
  })

  it('runs the same cleanup without requesting exit for owner-fiber disposal', async () => {
    const test = bench()
    await test.shutdown.shutdown('owner')
    expect(test.order).not.toContain('exit:0')
    expect(test.order.at(-1)).toBe('dispose-owned')
  })

  it('continues cleanup after a setup-stage failure and requests a failing user exit', async () => {
    const order: string[] = []
    const shutdown = createTuiShutdown({
      rejectInput: () => { order.push('reject') },
      settleInteractions: async () => { order.push('settle'); throw new Error('settle failed') },
      cancelAgent: () => { order.push('cancel') },
      whenIdle: async () => { order.push('idle') },
      flushSession: async () => { order.push('flush') },
      unmount: async () => { order.push('unmount') },
      restoreRawMode: () => { order.push('raw') },
      disposeOwned: async () => { order.push('dispose') },
      requestExit: (code) => { order.push(`exit:${code}`) },
    })
    await expect(shutdown.shutdown('user')).rejects.toThrow('settle failed')
    expect(order).toEqual(['reject', 'settle', 'cancel', 'idle', 'flush', 'unmount', 'raw', 'dispose', 'exit:1'])
  })

  it('wraps a non-Error cleanup rejection without discarding its cause', async () => {
    const test = bench()
    test.rejectInput.mockImplementationOnce(() => { throw 'input closed' })
    await expect(test.shutdown.shutdown('owner')).rejects.toMatchObject({
      message: 'tui shutdown failed',
      cause: 'input closed',
    })
  })
})
