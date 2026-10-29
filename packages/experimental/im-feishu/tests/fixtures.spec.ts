import { describe, expect, it } from 'vitest'
import { createSessionFormatCatalogWithChildren } from '@deepseek-ai/dsh-session-format-catalog'

describe('IM Feishu Session Format Fixtures (Public Catalog Reader)', () => {
  const catalog = createSessionFormatCatalogWithChildren([])

  const sources = [
    ['a', { kind: 'im', deliveryId: 'event-1' }],
    ['b', { kind: 'user', deliveryId: 'event-1' }],
    ['c', { kind: 'user', rpcId: '2d31b2a1-e68c-4cb7-91c6-6fb0ab8ad2f5' }],
  ] as const

  function runCatalogRestore(version: number, source: Record<string, unknown>): { accepted: boolean; error?: string } {
    try {
      const header = {
        type: 'session',
        version,
        id: `im-probe-v${String(version)}`,
        createdAt: 1,
        ...(version < 2 ? { seedLength: 0 } : { isSeeded: false }),
        delegationDepth: 0,
      } as Parameters<typeof catalog.createRestore>[0]

      const reader = catalog.createRestore(header, { recovery: 'strict', validation: 'current' })
      reader.decodeRow({ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } })
      reader.decodeRow({ type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } })
      reader.decodeRow({
        type: 'user/message',
        seq: 2,
        time: 2,
        data: {
          id: 'message-1',
          role: 'user',
          source,
          content: [{ type: 'text', text: 'Human operator prompt' }],
        },
        surfaceOp: 'append',
      })
      reader.decodeRow({ type: 'step/end', seq: 3, time: 3, data: { turn: 1, step: 1 } })
      reader.decodeRow({ type: 'turn/end', seq: 4, time: 3, data: { turn: 1, reason: { kind: 'completed' } } })

      reader.finish()
      return { accepted: true }
    } catch (error) {
      return {
        accepted: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  it('verifies Option (c) passes public restore across all generations 0 to 4', () => {
    for (const version of [0, 1, 2, 3, 4]) {
      const outcome = runCatalogRestore(version, sources[2][1])
      expect(outcome.accepted, `Version ${String(version)} Option (c) failed: ${outcome.error ?? ''}`).toBe(true)
    }
  })

  it('observes Option (a) fails migration for versions 0-2 as unclassified source but passes versions 3-4', () => {
    // Versions 0-2: cannot safely transform unclassified message source
    for (const version of [0, 1, 2]) {
      const outcome = runCatalogRestore(version, sources[0][1])
      expect(outcome.accepted).toBe(false)
      expect(outcome.error).toContain('cannot safely transform unclassified message source')
    }

    // Versions 3-4: accepted by current reader
    for (const version of [3, 4]) {
      const outcome = runCatalogRestore(version, sources[0][1])
      expect(outcome.accepted).toBe(true)
    }
  })

  it('observes Option (b) fails migration for versions 0-2 on unexpected deliveryId member but passes versions 3-4', () => {
    // Versions 0-2: refuses format due to unexpected member "deliveryId"
    for (const version of [0, 1, 2]) {
      const outcome = runCatalogRestore(version, sources[1][1])
      expect(outcome.accepted).toBe(false)
      expect(outcome.error).toMatch(/unexpected member "deliveryId"/)
    }

    // Versions 3-4: accepted by current reader (does not inherently require a bump for current format)
    for (const version of [3, 4]) {
      const outcome = runCatalogRestore(version, sources[1][1])
      expect(outcome.accepted).toBe(true)
    }
  })
})
