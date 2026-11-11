/** Generic card authorization and connection ownership. */
import { describe, expect, it, vi } from 'vitest'
import { CardConsumers, OwnedCardChannel, parseCardGeneration } from '../src/card-channel.ts'
import type { NormalizedFeishuCardAction } from '../src/feishu-normalizer.ts'

const binding = { appId: 'app', tenantId: 'tenant', chatId: 'chat', operatorId: 'operator', workspace: '/workspace',
  generation: parseCardGeneration('9f010e31-74bb-4d36-a192-4f56a6a89533') }
const action = (overrides: Partial<NormalizedFeishuCardAction> = {}): NormalizedFeishuCardAction => ({
  provider: 'feishu', appId: 'app', tenantKey: 'tenant', chatId: 'chat', operatorId: 'operator', openId: 'operator',
  openMessageId: 'message', actionTag: 'button', actionValue: { kind: 'test' }, token: 'not-persisted', ...overrides,
})
describe('owned generic card channel', () => {
  it('routes registered kinds and refuses foreign authenticated identities', async () => {
    const consumers = new CardConsumers()
    const handle = vi.fn(async () => ({ success: true }))
    const unregister = consumers.register('test', handle)
    const send = vi.fn(async () => ({ messageId: 'message' }))
    const channel = new OwnedCardChannel(binding, consumers, send, 1024)
    expect(await channel.handleCardAction(action())).toEqual({ success: true })
    for (const wrong of [action({ appId: 'other' }), action({ tenantKey: 'other' }), action({ chatId: 'other' }), action({ operatorId: 'other' })]) {
      expect((await channel.handleCardAction(wrong)).success).toBe(false)
    }
    expect(handle).toHaveBeenCalledTimes(1)
    unregister()
    expect((await channel.handleCardAction(action())).success).toBe(false)
    await channel.close()
  })
  it('bounds publication and closes admission before draining callbacks', async () => {
    const consumers = new CardConsumers()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    consumers.register('test', async () => { entered.resolve(undefined); await release.promise; return { success: true } })
    const send = vi.fn(async () => ({ messageId: 'message' }))
    const channel = new OwnedCardChannel(binding, consumers, send, 64)
    await expect(channel.publish({ text: 'x'.repeat(65) })).rejects.toThrow('byte limit')
    const operation = channel.handleCardAction(action())
    await entered.promise
    const closing = channel.close()
    expect((await channel.handleCardAction(action())).success).toBe(false)
    await expect(channel.publish({ text: 'x' })).rejects.toThrow('closed')
    release.resolve(undefined)
    await operation
    await closing
    expect(send).not.toHaveBeenCalled()
  })
  it('publishes once through the supplied owner and refuses duplicate consumers', async () => {
    const consumers = new CardConsumers()
    consumers.register('test', async () => ({ success: true }))
    expect(() => consumers.register('test', async () => ({ success: true }))).toThrow('already registered')
    const send = vi.fn(async () => ({ messageId: 'message' }))
    const channel = new OwnedCardChannel(binding, consumers, send, 1024)
    expect(await channel.publish({ text: 'question' })).toEqual({ messageId: 'message' })
    expect(send).toHaveBeenCalledTimes(1)
    await channel.close()
  })
})


it('rejects invalid durable generation values before opening a channel', () => {
  expect(() => parseCardGeneration('invalid-generation')).toThrow()
})

it('keeps a replacement consumer when the prior registration is disposed twice', async () => {
  const consumers = new CardConsumers()
  const first = consumers.register('test', async () => ({ success: false }))
  first()
  const replacement = vi.fn(async () => ({ success: true }))
  consumers.register('test', replacement)
  first()
  expect(await consumers.dispatch(action(), binding)).toEqual({ success: true })
  expect(replacement).toHaveBeenCalledTimes(1)
  expect(await consumers.dispatch(action({ actionValue: { kind: 3 } }), binding)).toMatchObject({ success: false })
  const channel = new OwnedCardChannel(binding, consumers, async () => { throw new Error('send failed') }, 1024)
  expect(await channel.handleCardAction(action({ actionTag: 'other' }))).toMatchObject({ success: false })
  await expect(channel.publish({ text: 'question' })).rejects.toThrow('send failed')
  await channel.close()
})
