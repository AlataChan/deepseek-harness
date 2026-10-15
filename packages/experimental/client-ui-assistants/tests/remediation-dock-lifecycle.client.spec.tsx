// @vitest-environment jsdom
/** Mounted composer integration uses real snapshots, cancellation, and editable insertion only. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SessionId } from '@deepseek-ai/dsh-session'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  ComposerPredictionContext,
  ComposerPredictionRequest,
  ComposerPredictionResult,
} from '@deepseek-ai/dsh-experimental-assistant-registry/types'
import { AssistantPredictionDock, type AssistantPredictionDockProps } from '../src/client/ComposerPrediction.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const session: SessionSnapshot = {
  sessionId: SessionId('real-dock'),
  pendingSubmissions: [],
  running: false,
  subagent: null,
  removed: false,
  openState: 'open',
  openError: null,
  hasMore: false,
  loadingOlder: false,
  promptError: null,
  blank: false,
  lastAgentError: null,
  promptAttempted: true,
  awaitingFirstTurn: false,
}
const result: ComposerPredictionResult = {
  predictionId: 'prediction-18',
  sessionId: session.sessionId,
  asOfSeq: 18,
  text: 'Useful continuation',
}
function props(extra: Partial<AssistantPredictionDockProps> = {}): AssistantPredictionDockProps {
  return {
    sessionId: session.sessionId,
    session,
    input: { draft: '', draftRev: 0, attachmentIds: [], phase: 'plain', occurrences: [], queue: [] },
    getComposerContext: async () => ({ asOfSeq: 18, recentTexts: ['Completed actual turn'] }),
    predictComposer: async () => result,
    t: makeTranslate(zh),
    ...extra,
  } as AssistantPredictionDockProps
}

describe('Mounted prediction lifecycle', () => {
  it.each(['typing', 'unmount', 'navigation', 'running'] as const)('aborts the in-flight remote inference on %s', async (change) => {
    const pending = Promise.withResolvers<ComposerPredictionResult | null>()
    const predictComposer = vi.fn((request: ComposerPredictionRequest, _signal?: AbortSignal) =>
      request.sessionId === session.sessionId ? pending.promise : Promise.resolve(null),
    )
    const p = props({ predictComposer })
    const view = render(<AssistantPredictionDock {...p} />)
    await waitFor(() => expect(predictComposer).toHaveBeenCalledOnce())
    const signal = predictComposer.mock.calls[0]![1] as AbortSignal
    expect(signal.aborted).toBe(false)
    if (change === 'unmount') view.unmount()
    if (change === 'typing') view.rerender(<AssistantPredictionDock {...p} input={{ ...p.input!, draft: 'Typing' }} />)
    if (change === 'navigation')
      view.rerender(
        <AssistantPredictionDock {...p} sessionId={SessionId('other-dock')} session={{ ...session, sessionId: SessionId('other-dock') }} />,
      )
    if (change === 'running') view.rerender(<AssistantPredictionDock {...p} session={{ ...session, running: true }} />)
    expect(signal.aborted).toBe(true)
    await act(async () => {
      pending.resolve(result)
      await pending.promise
    })
    expect(screen.queryByText(result.text)).toBeNull()
  })

  it('never resurrects the same completed-turn suggestion after typing and clearing', async () => {
    const predictComposer = vi.fn(async () => result)
    const p = props({ predictComposer })
    const view = render(<AssistantPredictionDock {...p} />)
    await screen.findByText(result.text)
    view.rerender(<AssistantPredictionDock {...p} input={{ ...p.input!, draft: 'Typed draft' }} />)
    view.rerender(<AssistantPredictionDock {...p} input={{ ...p.input!, draft: '' }} />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(predictComposer).toHaveBeenCalledOnce()
    expect(screen.queryByText(result.text)).toBeNull()
  })

  it('requests new completed-turn context when the actual snapshot transitions running to idle', async () => {
    let completedSeq = 18
    const getComposerContext = vi.fn(async () => ({ asOfSeq: completedSeq, recentTexts: [`Turn ${completedSeq}`] }))
    const predictComposer = vi.fn(async (request: ComposerPredictionRequest) => ({
      ...result,
      asOfSeq: request.asOfSeq,
      predictionId: `prediction-${request.asOfSeq}`,
    }))
    const p = props({ getComposerContext, predictComposer })
    const view = render(<AssistantPredictionDock {...p} />)
    await waitFor(() => expect(predictComposer).toHaveBeenCalledOnce())
    view.rerender(<AssistantPredictionDock {...p} session={{ ...session, running: true }} />)
    completedSeq = 29
    view.rerender(<AssistantPredictionDock {...p} session={{ ...session, running: false }} />)
    await waitFor(() => expect(predictComposer).toHaveBeenCalledTimes(2))
    expect(predictComposer.mock.calls[1]![0]).toMatchObject({ asOfSeq: 29, recentTexts: ['Turn 29'] })
  })

  it('prevents a late Host context response from starting inference after the user types', async () => {
    const deferred = Promise.withResolvers<ComposerPredictionContext | null>()
    const getComposerContext = vi.fn(() => deferred.promise)
    const predictComposer = vi.fn(async () => result)
    const p = props({ getComposerContext, predictComposer })
    const view = render(<AssistantPredictionDock {...p} />)
    await waitFor(() => expect(getComposerContext).toHaveBeenCalledOnce())
    view.rerender(<AssistantPredictionDock {...p} input={{ ...p.input!, draft: 'Typing' }} />)
    await act(async () => {
      deferred.resolve({ asOfSeq: 18, recentTexts: ['Late context'] })
      await deferred.promise
    })
    expect(predictComposer).not.toHaveBeenCalled()
    expect(screen.queryByText(result.text)).toBeNull()
  })

  it('adopts by captured editable insertion and never submits a prompt', async () => {
    const span = { start: 0, end: 0, draftRev: 7 }
    const captureInsertion = vi.fn(() => span)
    const insertText = vi.fn(() => true)
    const submit = vi.fn()
    const p = props({ inputActions: { captureInsertion, insertText, submit } as never })
    render(<AssistantPredictionDock {...p} />)
    await screen.findByText(result.text)
    fireEvent.click(screen.getByRole('button', { name: zh.predictionAdoptTab }))
    expect(captureInsertion).toHaveBeenCalledOnce()
    expect(insertText).toHaveBeenCalledWith(result.text, span)
    expect(submit).not.toHaveBeenCalled()
    expect(screen.queryByText(result.text)).toBeNull()
  })
})
