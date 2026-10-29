import { afterEach, describe, expect, onTestFinished, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import type { PendingSubmissionRetirement } from '../../../api/session-controller/src/client/contract/session.ts'
import type { SessionRequestId } from '../../../api/session-controller/src/types.ts'
import { sessionBench } from '../../../api/session-controller/tests/remote/bench.client.ts'
import { pushEvent } from '../../../api/session-controller/tests/remote/session.client.ts'

const API_ROSTER = webApp.closure(['@deepseek-ai/dsh-api-gateway'])
const clientTest = createClientTest({ roster: API_ROSTER })
const CLIENT_SID = 'im-isolation-client-session' as SessionId

function promptEvent(seq: SessionSeq, rpcId: SessionRequestId): SessionEvent {
  return {
    seq,
    time: 1_700_000_000_000 + Number(seq),
    type: 'user/message',
    surfaceOp: 'append',
    data: createUserMessage({
      content: [{ type: 'text', text: 'Prompt content' }],
      source: { kind: 'user', rpcId },
    }),
  }
}

describe('Client Face: IM SessionRequestId Settlement Isolation Tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  clientTest('IM SessionRequestId does not settle a distinct pending browser submission; matching browser SessionRequestId settles it', async ({ mock, start }) => {
    const session = await sessionBench(mock, start, CLIENT_SID)
    onTestFinished(async () => {
      await session.dispose()
    })
    await session.open()

    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })

    const flushFrames = (): void => {
      const callbacks = frames.splice(0)
      for (const cb of callbacks) cb(performance.now())
    }

    const retirements: PendingSubmissionRetirement[] = []
    const browserSubmission = session.beginSubmission({
      mode: 'queue',
      text: 'Browser pending text input',
      attachments: [],
      onRetire: retirement => retirements.push(retirement),
    })

    // The browser client has 1 pending submission
    expect(session.getSnapshot().pendingSubmissions).toHaveLength(1)
    expect(session.getSnapshot().pendingSubmissions[0]?.requestId).toBe(browserSubmission.requestId)

    // 1. A durable user event arrives with an independent minted IM SessionRequestId wire fixture
    // oxlint-disable-next-line eslint/no-restricted-properties -- Wire fixture in client unit test
    const imRequestId = brandString<SessionRequestId>(crypto.randomUUID())
    await pushEvent(mock, promptEvent(SessionSeq(0), imRequestId))
    flushFrames()

    // PROOF OF ISOLATION: The browser submission is NOT settled or retired by the IM prompt!
    expect(session.getSnapshot().pendingSubmissions).toHaveLength(1)
    expect(retirements).toEqual([])

    // 2. Control test: A durable event arrives with the MATCHING browser requestId
    await pushEvent(mock, promptEvent(SessionSeq(1), browserSubmission.requestId))
    flushFrames()

    // PROOF OF MATCHING SETTLEMENT: The matching browser submission is now settled and retired!
    expect(session.getSnapshot().pendingSubmissions).toEqual([])
    expect(retirements).toEqual([{ reason: 'observed', attachments: [] }])
  })
})
