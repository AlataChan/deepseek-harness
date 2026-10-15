/** Synthetic provider controls keep cancellation stalls scoped to the current owned request. */
import assert from 'node:assert/strict'
import { isOwnedHangRequest } from './verify-s20-installed-flows.mjs'

const marker = 'STAGE_C_HANG_OWNED_REQUEST'
assert.equal(isOwnedHangRequest({ messages: [{ role: 'user', content: [{ type: 'text', text: `[Shared transcript]\nreply\n[Current Task]\n${marker}` }] }] }), true)
assert.equal(isOwnedHangRequest({ messages: [{ role: 'user', content: marker }, { role: 'assistant', content: 'aborted' }, { role: 'user', content: 'Continue with a new task' }] }), false)
assert.equal(isOwnedHangRequest({ messages: [{ role: 'user', content: `Recent conversation context:\n${marker}\nTask: Suggest a concise question.` }] }), false)
console.log('Installed provider controls: 3 passed; current owned request hangs, historical and auxiliary requests do not.')
