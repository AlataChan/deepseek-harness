/** Independent checks that installed-flow rejection assertions fail on false positives. */
import assert from 'node:assert/strict'
import { assertRejected } from './verify-s20-installed-flows.mjs'

await assert.rejects(
  () => assertRejected(async () => ({ status: 'accepted' }), /admission conflict/i),
  /unexpectedly succeeded/,
)
await assert.rejects(
  () => assertRejected(async () => { throw new Error('RPC timed out') }, /admission conflict/i),
  /did not match/,
)
await assertRejected(async () => { throw new Error('Admission conflict: changed inputs') }, /admission conflict/i)
console.log('Installed acceptance rejection controls: 3 passed; false positives fail loudly.')
