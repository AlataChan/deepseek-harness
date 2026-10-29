/** Adversarial SDK lifetimes must fail within the configured deadline and keep one cleanup result. */
import { EventDispatcher } from '@larksuiteoapi/node-sdk'
import { expect, it, vi } from 'vitest'
import { FeishuTransport, type FeishuWSClientLike } from '../src/feishu-transport.ts'

it('bounds an SDK start promise that never settles before the startup deadline', async () => {
  vi.useFakeTimers()
  const release = Promise.withResolvers<undefined>()
  let connected = false
  const client: FeishuWSClientLike = {
    start: async () => { await release.promise; connected = true },
    close: () => { connected = false },
    getConnectionStatus: () => ({ state: connected ? 'connected' : 'connecting' }),
  }
  const transport = new FeishuTransport({ appId: 'app', appSecret: 'fixture-only',
    startupTimeoutMs: 20, shutdownTimeoutMs: 50 }, {
    handleIncomingMessage: () => Promise.reject(new Error('unused')),
  }, undefined, { clientFactory: {
    createWSClient: () => client, createEventDispatcher: () => new EventDispatcher({}),
  } })
  let result: 'pending' | 'resolved' | 'rejected' = 'pending'
  const starting = transport.start()
  void starting.then(() => { result = 'resolved' }, () => { result = 'rejected' })
  try {
    await vi.advanceTimersByTimeAsync(200)
    expect(result).toBe('rejected')
    release.resolve(undefined)
    await vi.advanceTimersByTimeAsync(200)
    expect(connected).toBe(false)
  } finally {
    release.resolve(undefined)
    await vi.advanceTimersByTimeAsync(200)
    await Promise.allSettled([starting, transport.close()])
    vi.useRealTimers()
  }
})

it('reports the same cleanup failure to a synchronous reentrant close caller', async () => {
  let nested: Promise<void> | undefined
  const client: FeishuWSClientLike = {
    start: () => Promise.resolve(), getConnectionStatus: () => ({ state: 'connected' }),
    close: () => {
      nested = transport.close()
      void nested.catch(() => undefined)
      throw new Error('SDK close failed')
    },
  }
  const transport = new FeishuTransport({ appId: 'app', appSecret: 'fixture-only', shutdownTimeoutMs: 50 }, {
    handleIncomingMessage: () => Promise.reject(new Error('unused')),
  }, undefined, { clientFactory: {
    createWSClient: () => client, createEventDispatcher: () => new EventDispatcher({}),
  } })
  await transport.start()
  await expect(transport.close()).rejects.toThrow(/close|cleanup/)
  if (!nested) throw new Error('Missing reentrant close')
  await expect(nested).rejects.toThrow(/close|cleanup/)
})

it('refuses to claim cleanup while the underlying SDK startup is still unsettled', async () => {
  vi.useFakeTimers()
  const release = Promise.withResolvers<undefined>()
  const client: FeishuWSClientLike = {
    start: async () => { await release.promise }, close: () => undefined,
    getConnectionStatus: () => ({ state: 'connecting' }),
  }
  const transport = new FeishuTransport({ appId: 'app', appSecret: 'fixture-only',
    startupTimeoutMs: 20, shutdownTimeoutMs: 50 }, {
    handleIncomingMessage: () => Promise.reject(new Error('unused')),
  }, undefined, { clientFactory: {
    createWSClient: () => client, createEventDispatcher: () => new EventDispatcher({}),
  } })
  const starting = transport.start()
  void starting.catch(() => undefined)
  let closing: Promise<void> | undefined
  try {
    await vi.advanceTimersByTimeAsync(200)
    await expect(starting).rejects.toThrow('timed out')
    closing = transport.close()
    void closing.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(200)
    await expect(closing).rejects.toThrow(/timed out|deadline/)
  } finally {
    release.resolve(undefined)
    await vi.advanceTimersByTimeAsync(200)
    await Promise.allSettled([starting, transport.close()])
    vi.useRealTimers()
  }
})

it('retains the failed SDK close result after an immediate startup error', async () => {
  const client: FeishuWSClientLike = {
    start: () => Promise.reject(new Error('SDK start failed')),
    close: () => { throw new Error('SDK close failed') },
    getConnectionStatus: () => ({ state: 'failed' }),
  }
  const transport = new FeishuTransport({ appId: 'app', appSecret: 'fixture-only' }, {
    handleIncomingMessage: () => Promise.reject(new Error('unused')),
  }, undefined, { clientFactory: {
    createWSClient: () => client, createEventDispatcher: () => new EventDispatcher({}),
  } })
  await expect(transport.start()).rejects.toThrow(/start|cleanup/)
  await expect(transport.close()).rejects.toThrow(/close|cleanup/)
})

it('keeps asynchronous SDK loading owned beyond the public startup timeout', async () => {
  vi.useFakeTimers()
  const release = Promise.withResolvers<undefined>()
  vi.doMock('@larksuiteoapi/node-sdk', async () => {
    await release.promise
    return { EventDispatcher, WSClient: class {
      start(): Promise<void> { return Promise.resolve() }
      close(): void { /* No network resources in the delayed loader fixture. */ }
      getConnectionStatus(): { state: 'connected' } { return { state: 'connected' } }
    } }
  })
  const transport = new FeishuTransport({ appId: 'app', appSecret: 'fixture-only',
    startupTimeoutMs: 20, shutdownTimeoutMs: 50 }, {
    handleIncomingMessage: () => Promise.reject(new Error('unused')),
  })
  const starting = transport.start()
  void starting.catch(() => undefined)
  try {
    await vi.advanceTimersByTimeAsync(200)
    await expect(starting).rejects.toThrow('timed out')
    const closing = transport.close()
    void closing.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(200)
    await expect(closing).rejects.toThrow(/timed out|deadline/)
  } finally {
    release.resolve(undefined)
    await vi.advanceTimersByTimeAsync(200)
    await Promise.allSettled([starting, transport.close()])
    vi.doUnmock('@larksuiteoapi/node-sdk')
    vi.useRealTimers()
  }
})
