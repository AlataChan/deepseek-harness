/** Commerce tool provenance projection behavior. */

import { describe, expect, it } from 'vitest'
import { ChangeId, CommerceSourceId, ListingId } from '@deepseek-ai/dsh-host-commerce'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { commerceSessionProjectionDefinition } from '../../src/tools/projection.ts'

function fold(events: readonly SessionEvent[]) {
  let state = commerceSessionProjectionDefinition.init()
  for (const event of events) state = commerceSessionProjectionDefinition.apply(state, event)
  return state
}

describe('commerceSession projection', () => {
  it('folds binding and root commerce provenance identically for live and replayed logs', () => {
    const session = Session.create(SessionId('commerce-projection'))
    session.append('commerce/bound', {
      sourceId: CommerceSourceId('source-1'), displayName: 'Shop', kinds: ['products'],
    })
    session.append('tool/call', {
      turn: 1, step: 1, callId: ToolCallId('call-search'), name: 'commerce_search_listings', arguments: '{}',
    })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call-search'), content: [{ type: 'text', text: 'result' }], isError: false,
      }),
      meta: { listingIds: ['listing-1', 'listing-2'], fullListing: false },
    }, { surfaceOp: 'append' })
    session.append('tool/call', {
      turn: 1, step: 2, callId: ToolCallId('call-get'), name: 'commerce_get_listing', arguments: '{}',
    })
    session.append('tool/result', {
      turn: 1, step: 2,
      message: createToolResultMessage({
        callId: ToolCallId('call-get'), content: [{ type: 'text', text: 'result' }], isError: false,
      }),
      meta: { listingIds: ['listing-2'], fullListing: true },
    }, { surfaceOp: 'append' })

    const events = session.snapshotEvents()
    expect(fold(events)).toEqual(fold(Session.create(SessionId('replay'), events).snapshotEvents()))
    expect(fold(events)).toEqual({
      binding: { sourceId: CommerceSourceId('source-1'), displayName: 'Shop', kinds: ['products'] },
      readListingIds: ['listing-1', 'listing-2'],
      fullReadListingIds: ['listing-2'],
      ledger: [], pendingCalls: {},
    })
  })

  it('ignores unknown calls and results without metadata', () => {
    const session = Session.create(SessionId('commerce-projection-ignored'))
    session.append('tool/call', {
      turn: 1, step: 1, callId: ToolCallId('call-other'), name: 'read', arguments: '{}',
    })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call-other'), content: [{ type: 'text', text: 'result' }], isError: false,
      }),
    }, { surfaceOp: 'append' })
    expect(fold(session.snapshotEvents())).toEqual({
      binding: null, readListingIds: [], fullReadListingIds: [], ledger: [], pendingCalls: {},
    })
  })

  it('ignores listing ids attached to model-authored analysis results', () => {
    const session = Session.create(SessionId('commerce-projection-analysis'))
    session.append('tool/call', {
      turn: 1, step: 1, callId: ToolCallId('call-analysis'), name: 'commerce_analysis_query', arguments: '{}',
    })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call-analysis'), content: [{ type: 'text', text: 'result' }], isError: false,
      }),
      meta: { listingIds: ['X-1'], fullListing: false },
    }, { surfaceOp: 'append' })
    expect(fold(session.snapshotEvents())).toEqual({
      binding: null, readListingIds: [], fullReadListingIds: [], ledger: [], pendingCalls: {},
    })
  })

  it('folds staged changes and discards into the ledger identically on replay', () => {
    const session = Session.create(SessionId('commerce-ledger'))
    const staged = {
      id: 'chg-0001', kind: 'price-change', summary: 'Raise tea price', status: 'staged',
      items: [{ listingId: 'P-1', field: 'price', before: 10, after: 11 }],
    }
    const record = (callId: string, name: string, meta: JsonValue) => {
      session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId(callId), name, arguments: '{}' })
      session.append('tool/result', {
        turn: 1, step: 1,
        message: createToolResultMessage({ callId: ToolCallId(callId), content: [{ type: 'text', text: 'ok' }], isError: false }),
        meta,
      }, { surfaceOp: 'append' })
    }
    record('call-stage', 'commerce_stage_price_change', { listingIds: [], fullListing: false, staged })
    record('call-read', 'commerce_search_listings', {
      listingIds: [], fullListing: false, staged: { ...staged, id: 'chg-0009' },
    })
    record('call-discard', 'commerce_discard_change', { listingIds: [], fullListing: false, discardedChangeId: 'chg-0001' })

    const events = session.snapshotEvents()
    const state = fold(events)
    expect(state).toEqual(fold(Session.create(SessionId('ledger-replay'), events).snapshotEvents()))
    expect(state.ledger).toEqual([{
      id: ChangeId('chg-0001'), kind: 'price-change', summary: 'Raise tea price', status: 'discarded',
      items: [{ listingId: ListingId('P-1'), field: 'price', before: 10, after: 11 }],
    }])
    expect(commerceSessionProjectionDefinition.wire.view(state)).toMatchObject({ ledger: state.ledger })
  })
})
