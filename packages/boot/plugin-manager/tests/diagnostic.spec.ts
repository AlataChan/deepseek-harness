import { expect, it } from 'vitest'
import { parsePluginOperationRecord } from '../src/diagnostic.ts'

const input = {
  runId: 'c254ab28-97c9-4382-95e6-2db9c66f98c8', transportDropped: 0,
  operation: { id: 'c254ab28-97c9-4382-95e6-2db9c66f98c9', time: '2026-10-19T00:00:00.000Z',
    reason: 'plugin', phase: 'settled', target: 'managed', stage: 'enable', changed: true, application: 'restart-required' },
}

it('keeps only diagnostic fields at both record levels', () => {
  expect(parsePluginOperationRecord({ ...input, credential: 'secret', operation: {
    ...input.operation, diagnostic: 'raw secret output', packageResult: { output: 'raw output' },
  } })).toEqual(input)
})

it('rejects unsupported phases, oversized identifiers and invalid result fields', () => {
  for (const patch of [{ phase: 'future' }, { id: 'invalid' }, { target: 'x'.repeat(257) },
    { time: 'not a time' }, { changed: 'yes' }, { application: 'unknown-success' }, { errorCode: 'raw-message' }]) {
    expect(parsePluginOperationRecord({ ...input, operation: { ...input.operation, ...patch } })).toBeUndefined()
  }
  expect(parsePluginOperationRecord({ ...input, transportDropped: -1 })).toBeUndefined()
  expect(parsePluginOperationRecord({ ...input, runId: '' })).toBeUndefined()
})

it('retains an observed version before an operation settles', () => {
  const started = { ...input, operation: { ...input.operation, phase: 'started', version: '1.2.3' } }
  expect(parsePluginOperationRecord(started)?.operation).toMatchObject({ phase: 'started', version: '1.2.3' })
  expect(parsePluginOperationRecord({ ...started, operation: { ...started.operation, version: 'x'.repeat(129) } })).toBeUndefined()
})

it('retains compatibility refusals in settled operation records', () => {
  const record = { ...input, operation: { ...input.operation, application: 'failed', changed: false, errorCode: 'incompatible-version' } }
  expect(parsePluginOperationRecord(record)).toEqual(record)
})

it('rejects oversized complete records and cyclic values', () => {
  expect(parsePluginOperationRecord({ ...input, extra: '界'.repeat(24000) })).toBeUndefined()
  const cyclic = { self: input as object }; cyclic.self = cyclic
  expect(parsePluginOperationRecord(cyclic)).toBeUndefined()
})
