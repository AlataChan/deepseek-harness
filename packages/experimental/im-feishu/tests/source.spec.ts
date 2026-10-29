import { describe, expect, it } from 'vitest'
import {
  createImPromptSource,
  encodeDeliveryKey,
  mintImSessionRequestId,
  parseFeishuAppId,
  parseFeishuChatId,
  parseFeishuEventId,
  parseFeishuSenderId,
  parseFeishuTenantId,
  type ImDeliveryKey,
} from '../src/index.ts'

describe('IM Feishu Source and Identity Helpers', () => {
  it('mints independent cryptographically random UUID v4 SessionRequestIds', () => {
    const id1 = mintImSessionRequestId()
    const id2 = mintImSessionRequestId()

    expect(id1).not.toBe(id2)
    // UUID v4 format verification
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('creates canonical Option (c) user prompt source without platform IDs', () => {
    const requestId = mintImSessionRequestId()
    const source = createImPromptSource(requestId, 'Asia/Shanghai')

    expect(source.kind).toBe('user')
    expect(source).toEqual({
      kind: 'user',
      rpcId: requestId,
      clientTimeZone: 'Asia/Shanghai',
    })
    expect(source).not.toHaveProperty('deliveryId')
    expect(source).not.toHaveProperty('tenantId')
    expect(source).not.toHaveProperty('appId')
  })

  it('omits clientTimeZone when not provided', () => {
    const requestId = mintImSessionRequestId()
    const source = createImPromptSource(requestId)

    expect(source).toEqual({
      kind: 'user',
      rpcId: requestId,
    })
  })

  it('brands external Feishu identifiers and throws on empty input', () => {
    expect(parseFeishuAppId('cli_a1b2c3')).toBe('cli_a1b2c3')
    expect(parseFeishuTenantId('tenant_xyz')).toBe('tenant_xyz')
    expect(parseFeishuChatId('oc_123456')).toBe('oc_123456')
    expect(parseFeishuSenderId('ou_sender99')).toBe('ou_sender99')
    expect(parseFeishuEventId('evt_evt777')).toBe('evt_evt777')

    expect(() => parseFeishuAppId('')).toThrow(TypeError)
    expect(() => parseFeishuTenantId('   ')).toThrow(TypeError)
    expect(() => parseFeishuChatId('')).toThrow(TypeError)
    expect(() => parseFeishuSenderId('')).toThrow(TypeError)
    expect(() => parseFeishuEventId('')).toThrow(TypeError)
  })

  it('encodes delivery keys injectively preventing delimiter collisions (C1 regression)', () => {
    // Regression for C1: appId="a:b", tenantId="c" vs appId="a", tenantId="b:c"
    const key1: ImDeliveryKey = {
      provider: 'feishu',
      appId: parseFeishuAppId('a:b'),
      tenantId: parseFeishuTenantId('c'),
      chatId: parseFeishuChatId('chat1'),
      senderId: parseFeishuSenderId('user1'),
      eventId: parseFeishuEventId('evt1'),
    }

    const key2: ImDeliveryKey = {
      provider: 'feishu',
      appId: parseFeishuAppId('a'),
      tenantId: parseFeishuTenantId('b:c'),
      chatId: parseFeishuChatId('chat1'),
      senderId: parseFeishuSenderId('user1'),
      eventId: parseFeishuEventId('evt1'),
    }

    const encoded1 = encodeDeliveryKey(key1)
    const encoded2 = encodeDeliveryKey(key2)

    expect(encoded1).not.toBe(encoded2)
    expect(encoded1).toBe(JSON.stringify(['feishu', 'a:b', 'c', 'chat1', 'user1', 'evt1']))
    expect(encoded2).toBe(JSON.stringify(['feishu', 'a', 'b:c', 'chat1', 'user1', 'evt1']))
  })
})
