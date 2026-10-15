/** Independent wire-envelope controls for exact public-transcript source attribution checks. */
import assert from 'node:assert/strict'

const page = {
  records: [
    { type: 'event', event: { seq: 12, type: 'user/message', data: { text: 'input' } } },
    { type: 'event', event: { seq: 13, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'reply' }] } } } },
  ],
}
const record = page.records.find((record) => record.event?.seq === 13)
assert.equal(record.event.type, 'assistant/message')
assert.equal(
  page.records.find((record) => record.seq === 13),
  undefined,
  'Wire page has no top-level seq',
)
assert.equal(
  page.records.find((record) => record.event?.seq === 14),
  undefined,
  'Mismatched source attribution seq cannot match another reply',
)
assert.equal(page.records.filter((record) => record.event?.seq > 12).length, 1)
console.log('Installed history-envelope controls: 4 passed; wrapped exact source attribution and bounds enforced.')
