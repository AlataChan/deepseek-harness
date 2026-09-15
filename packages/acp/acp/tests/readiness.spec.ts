/** ACP initialize answers only after the Loader tree settles. */

import { afterEach, describe, expect, it } from 'vitest'
import { makeBridgeHarness, type BridgeHarness } from './harness.ts'

let harness: BridgeHarness | undefined

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

describe('ACP readiness boundary', () => {
  it('holds initialize until the Loader settles, so late sibling tools reach the first request', async () => {
    harness = await makeBridgeHarness()
    let settle!: () => void
    const settlement = new Promise<void>((resolve) => { settle = resolve })
    harness.ctx.provide('loader', { await: () => settlement } as never)

    let answered = false
    const initialized = Promise.resolve(harness.client.initialize({ protocolVersion: 1 })).then((response) => {
      answered = true
      return response
    })
    // Requests run concurrently: an answered later request proves initialize reached its Loader wait.
    await harness.client.authenticate({ methodId: 'none' })
    expect(answered).toBe(false)

    settle()
    await expect(initialized).resolves.toMatchObject({ protocolVersion: 1 })
  })

  it('answers initialize immediately in a context without a Loader', async () => {
    harness = await makeBridgeHarness()
    await expect(harness.client.initialize({ protocolVersion: 1 })).resolves.toMatchObject({ protocolVersion: 1 })
  })
})
