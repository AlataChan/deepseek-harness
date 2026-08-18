/** Shared behavioral checks for every browser-side ConnectionHandle provider. */

import { describe, expect, it, vi } from 'vitest'
import type { ConnectionHandle } from '../src/client/index.ts'

/** Mount function used by the shared ConnectionHandle behavior suite. */
export type MountConnectionHandle = () => Promise<ConnectionHandle>

/**
 * Register transport-independent ConnectionHandle ownership and description checks.
 * @param label - transport name shown in test output.
 * @param mount - fresh connected-capable handle factory.
 */
export function connectionHandleBehavior(label: string, mount: MountConnectionHandle): void {
  describe(`${label} ConnectionHandle behavior`, () => {
    it('publishes one connection generation, enforces one owner, and retracts on stop', async () => {
      const handle = await mount()
      const descriptions: Array<boolean | undefined> = []
      const unsubscribe = handle.hostDescription.subscribe(() => {
        descriptions.push(handle.hostDescription.getSnapshot()?.canOpenPath)
      })
      const connected = vi.fn()
      const loop = handle.start({ onConnected: connected }, {
        backoffBaseMs: 5,
        backoffFactor: 1,
        backoffMaxMs: 5,
        streamOpenTimeoutMs: 100,
      })
      try {
        expect(() => { handle.start({}) }).toThrow(/already owned/)
        await vi.waitFor(() => { expect(handle.hostDescription.getSnapshot()?.canOpenPath).toBe(true) })
        expect(connected).toHaveBeenCalledOnce()
      } finally {
        loop.stop()
        unsubscribe()
      }
      expect(handle.hostDescription.getSnapshot()).toBeUndefined()
      expect(descriptions).toEqual([true, undefined])
    })
  })
}
