// @vitest-environment jsdom
import { it, expect, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { SessionId } from '@deepseek-ai/dsh-session'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { AssistantPredictionDock, type AssistantPredictionDockProps } from '../src/client/ComposerPrediction.tsx'
import { zh } from '../src/client/locales.ts'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
it('requests a prediction after a completed turn using the real Client snapshot properties', async () => {
  const session: SessionSnapshot = {
    sessionId: SessionId('review-dock'),
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
  const predictComposer = vi.fn().mockResolvedValue(null)
  const props = {
    sessionId: session.sessionId,
    session,
    input: { draft: '', draftRev: 0, attachmentIds: [], phase: 'plain', occurrences: [], queue: [] },
    getComposerContext: async () => ({ asOfSeq: 18, recentTexts: ['Completed real turn'] }),
    predictComposer,
    t: makeTranslate(zh),
  } as AssistantPredictionDockProps
  try {
    const view = render(<AssistantPredictionDock {...props} session={{ ...session, running:true }} />)
    view.rerender(<AssistantPredictionDock {...props} />)
    await waitFor(() => expect(predictComposer).toHaveBeenCalledTimes(1), { timeout: 250 })
  } finally {
    cleanup()
  }
})
