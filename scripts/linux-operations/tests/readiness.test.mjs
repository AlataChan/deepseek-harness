/** Startup must not accept a model turn while the required tool generation is still loading. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../readiness.mjs'

test('runtime readiness waits for every required tool, then publishes its service', async () => {
  const seen = new Set()
  let dispose
  let ready = false
  const ctx = { tools: { get: name => seen.has(name) }, effect: callback => { dispose = callback() },
    provide: (name, value) => { assert.equal(name, 'octopusOpsReady'); assert(value.ready); ready = true } }
  const pending = apply(ctx, { timeoutMs: 1000, pollIntervalMs: 1 })
  assert.equal(ready, false)
  for (const name of ['host_status', 'service_status', 'service_logs', 'wechat_status', 'wechat_screenshot', 'prepare', 'execute']) seen.add(`mcp__server_ops__${name}`)
  await new Promise(resolve => setTimeout(resolve, 3))
  assert.equal(ready, false)
  seen.add('mcp__server_ops__receipt')
  await pending
  assert.equal(ready, true)
  dispose()
})

test('missing required tools fail closed with a bounded deadline', async () => {
  let dispose
  const ctx = { tools: { get: () => undefined }, effect: callback => { dispose = callback() },
    provide: () => { throw new Error('Must not publish readiness') } }
  await assert.rejects(apply(ctx, { timeoutMs: 5, pollIntervalMs: 1 }), /did not become ready/)
  dispose()
})
