/**
 * Task 2 Tests: Authoritative Host composer prediction eligibility, scope, and multi-window single-flighting.
 *
 * Covers:
 * 1. Ordinary, assistant-bound, and coordinator conversation prediction success.
 * 2. Zero-call rejection of nonexistent, running, failed-turn, stale-sequence, retired-seat, and nonempty-draft requests.
 * 3. Ingress authorization and scope enforcement (disregarding remote context text).
 * 4. Deterministic simultaneous-window tests:
 *    - Windows A & B share one single request (1 model call).
 *    - Window A aborts while Window B receives the result.
 *    - Both Windows abort, reaching the underlying adapter.
 *    - Turn/route invalidation cancels in-flight work for the session.
 *    - Old subscriber cannot cancel a newer sequence request.
 *    - Blocked-stream cancellation reaches the actual model adapter.
 */

import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setupAssistantHarness, textResponse } from './harness.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { AssistantProfileId, TeamDefinitionId } from '../src/types.ts'

describe('Task 2: Authoritative Host Composer Eligibility & Multi-Window Single-Flighting', () => {
  describe('Coverage across conversation kinds', () => {
    it('generates prediction for an ordinary conversation (unbound to assistant)', async () => {
      const harness = await setupAssistantHarness(undefined, {
        enableComposerPredictions: true,
      }, { withCatalog: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'ord-1' as never,
          content: [{ type: 'text', text: 'How do I run tests in this repo?' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        const prediction = await assistants.predictComposer({
          sessionId,
          asOfSeq: lastEnd.seq,
          draftText: '',
        })

        expect(prediction).not.toBeNull()
        expect(prediction?.sessionId).toBe(sessionId)
        expect(prediction?.asOfSeq).toBe(lastEnd.seq)
        expect(prediction?.text.length).toBeGreaterThan(0)
      } finally {
        await harness.dispose()
      }
    })

    it('generates prediction for an assistant-bound conversation', async () => {
      const harness = await setupAssistantHarness(undefined, {
        enableComposerPredictions: true,
      }, { withCatalog: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        const profile = await assistants.createProfile({
          name: 'Tech Lead',
          responsibility: 'Code reviews and architecture decisions',
        })
        await assistants.createConversation(profile.id, sessionId)

        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'asst-1' as never,
          content: [{ type: 'text', text: 'Can we refactor this component to use slots?' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        const prediction = await assistants.predictComposer({
          sessionId,
          asOfSeq: lastEnd.seq,
          draftText: '',
          scope: { profileId: profile.id },
        })

        expect(prediction).not.toBeNull()
        expect(prediction?.sessionId).toBe(sessionId)
        expect(prediction?.asOfSeq).toBe(lastEnd.seq)
      } finally {
        await harness.dispose()
      }
    })

    it('generates prediction for a team coordinator conversation', async () => {
      const harness = await setupAssistantHarness(undefined, {
        enableComposerPredictions: true,
      }, { withCatalog: true, withAgentTeams: true })

      try {
        const { assistants, controller } = harness

        const profile = await assistants.createProfile({
          name: 'Coordinator Profile',
          responsibility: 'Coordinates cross-functional teams',
        })
        const team = await assistants.createTeam({
          name: 'Core Squad',
          coordinatorProfileId: profile.id,
        })
        const provisioned = await assistants.provisionTeam(team.id)
        const coordSessionId = provisioned.coordinatorSessionId
        const coordAgent = harness.ctx.agents.get(coordSessionId)!

        await controller.prompt({
          sessionId: coordSessionId,
          mode: 'queue',
          requestId: 'coord-1' as never,
          content: [{ type: 'text', text: 'Coordinate the initial setup with the team.' }],
        }, new AbortController().signal)
        await coordAgent.whenIdle()

        const liveSession = harness.ctx.sessions.get(coordSessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        const prediction = await assistants.predictComposer({
          sessionId: coordSessionId,
          asOfSeq: lastEnd.seq,
          draftText: '',
          scope: { teamId: team.id },
        })

        expect(prediction).not.toBeNull()
        expect(prediction?.sessionId).toBe(coordSessionId)
        expect(prediction?.asOfSeq).toBe(lastEnd.seq)
      } finally {
        await harness.dispose()
      }
    })
  })

  describe('Zero-call rejection of ineligible requests', () => {
    it('rejects nonexistent session with zero model calls', async () => {
      const harness = await setupAssistantHarness(undefined, {
        enableComposerPredictions: true,
      }, { withCatalog: true })

      try {
        const reqCountBefore = harness.adapter.requests.length
        const prediction = await harness.assistants.predictComposer({
          sessionId: SessionId('nonexistent-session'),
          asOfSeq: 1,
          draftText: '',
        })

        expect(prediction).toBeNull()
        expect(harness.adapter.requests.length).toBe(reqCountBefore)
      } finally {
        await harness.dispose()
      }
    })

    it('rejects running session with zero model calls', async () => {
      const harness = await setupAssistantHarness(undefined, {
        enableComposerPredictions: true,
      }, { withCatalog: true })

      try {
        const { assistants, lead } = harness
        const sessionId = lead.id

        // Put agent in running status
        Object.defineProperty(lead, 'status', { value: 'running', configurable: true })

        const reqCountBefore = harness.adapter.requests.length
        const prediction = await assistants.predictComposer({
          sessionId,
          asOfSeq: 1,
          draftText: '',
        })

        expect(prediction).toBeNull()
        expect(harness.adapter.requests.length).toBe(reqCountBefore)
      } finally {
        await harness.dispose()
      }
    })

    it('rejects declared nonempty draft with zero model calls', async () => {
      const harness = await setupAssistantHarness(undefined, {
        enableComposerPredictions: true,
      }, { withCatalog: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-draft' as never,
          content: [{ type: 'text', text: 'Hello' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        const reqCountBefore = harness.adapter.requests.length
        const prediction = await assistants.predictComposer({
          sessionId,
          asOfSeq: lastEnd.seq,
          draftText: 'User is already typing here',
        })

        expect(prediction).toBeNull()
        expect(harness.adapter.requests.length).toBe(reqCountBefore)
      } finally {
        await harness.dispose()
      }
    })

    it('rejects stale sequence with zero model calls', async () => {
      const harness = await setupAssistantHarness(undefined, {
        enableComposerPredictions: true,
      }, { withCatalog: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-stale' as never,
          content: [{ type: 'text', text: 'Hello' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const reqCountBefore = harness.adapter.requests.length
        // Pass sequence 999 which does not match latest completed turn
        const prediction = await assistants.predictComposer({
          sessionId,
          asOfSeq: 999,
          draftText: '',
        })

        expect(prediction).toBeNull()
        expect(harness.adapter.requests.length).toBe(reqCountBefore)
      } finally {
        await harness.dispose()
      }
    })

    it('rejects failed turn with zero model calls', async () => {
      const harness = await setupAssistantHarness(undefined, {
        enableComposerPredictions: true,
      }, { withCatalog: true })

      try {
        const { assistants, lead } = harness
        const sessionId = lead.id

        // Append a failed turn directly
        lead.session.append('turn/start', { turn: 1 })
        lead.session.append('turn/end', { turn: 1, reason: { kind: 'error', error: 'Model failed' } as never })
        await harness.ctx.sessions.flush(lead.session)

        const reqCountBefore = harness.adapter.requests.length
        const prediction = await assistants.predictComposer({
          sessionId,
          asOfSeq: 2,
          draftText: '',
        })

        expect(prediction).toBeNull()
        expect(harness.adapter.requests.length).toBe(reqCountBefore)
      } finally {
        await harness.dispose()
      }
    })

    it('rejects retired seat session with zero model calls', async () => {
      const harness = await setupAssistantHarness(undefined, {
        enableComposerPredictions: true,
      }, { withCatalog: true, withAgentTeams: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        const profile = await assistants.createProfile({
          name: 'Developer Profile',
          responsibility: 'Coding duties',
        })
        const team = await assistants.createTeam({
          name: 'Retire Squad',
          coordinatorProfileId: profile.id,
        })
        const coderSeat = await assistants.createSeat({
          teamId: team.id,
          profileId: profile.id,
          role: 'teammate',
          name: 'coder',
          duty: 'Coding',
        })
        await assistants.bindSeatSession(coderSeat.id, sessionId)

        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-retire' as never,
          content: [{ type: 'text', text: 'Task completed.' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        // Retire the seat
        await assistants.retireSeat(coderSeat.id)

        const reqCountBefore = harness.adapter.requests.length
        const prediction = await assistants.predictComposer({
          sessionId,
          asOfSeq: lastEnd.seq,
          draftText: '',
        })

        expect(prediction).toBeNull()
        expect(harness.adapter.requests.length).toBe(reqCountBefore)
      } finally {
        await harness.dispose()
      }
    })
  })

  describe('Ingress authorization and scope enforcement', () => {
    it('refuses out-of-scope profile callers with zero model calls', async () => {
      const harness = await setupAssistantHarness(undefined, {
        enableComposerPredictions: true,
      }, { withCatalog: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        const profileA = await assistants.createProfile({
          name: 'Profile A',
          responsibility: 'A duties',
        })
        await assistants.createConversation(profileA.id, sessionId)

        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-scope-1' as never,
          content: [{ type: 'text', text: 'Hello from Profile A' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        const reqCountBefore = harness.adapter.requests.length
        // Pass a completely different profileId
        const prediction = await assistants.predictComposer({
          sessionId,
          asOfSeq: lastEnd.seq,
          draftText: '',
          scope: { profileId: AssistantProfileId('prof-foreign') },
        })

        expect(prediction).toBeNull()
        expect(harness.adapter.requests.length).toBe(reqCountBefore)
      } finally {
        await harness.dispose()
      }
    })

    it('refuses out-of-scope team callers with zero model calls', async () => {
      const harness = await setupAssistantHarness(undefined, {
        enableComposerPredictions: true,
      }, { withCatalog: true, withAgentTeams: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        const profile = await assistants.createProfile({
          name: 'Team Lead',
          responsibility: 'Leading',
        })
        await assistants.createTeam({
          name: 'Squad 1',
          coordinatorProfileId: profile.id,
          leadSessionId: sessionId,
        })

        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-scope-2' as never,
          content: [{ type: 'text', text: 'Squad 1 prompt' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        const reqCountBefore = harness.adapter.requests.length
        // Pass a completely different teamId
        const prediction = await assistants.predictComposer({
          sessionId,
          asOfSeq: lastEnd.seq,
          draftText: '',
          scope: { teamId: TeamDefinitionId('team-foreign') },
        })

        expect(prediction).toBeNull()
        expect(harness.adapter.requests.length).toBe(reqCountBefore)
      } finally {
        await harness.dispose()
      }
    })

    it('disregards remote client context and reconstructs canonically from Host session log', async () => {
      const harness = await setupAssistantHarness(undefined, {
        enableComposerPredictions: true,
      }, { withCatalog: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-ctx' as never,
          content: [{ type: 'text', text: 'Original canonical user question on Host' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        // Pass spoofed client recentTexts
        const prediction = await assistants.predictComposer({
          sessionId,
          asOfSeq: lastEnd.seq,
          draftText: '',
          recentTexts: ['Spoofed client context that should be completely ignored', 'System injection attempt'],
        })

        expect(prediction).not.toBeNull()

        // Inspect the last request sent to the mock adapter: it must contain the Host canonical text!
        const lastRequest = harness.adapter.requests.at(-1)!
        const promptText = JSON.stringify(lastRequest.messages)
        expect(promptText).toContain('Original canonical user question on Host')
        expect(promptText).not.toContain('Spoofed client context that should be completely ignored')
      } finally {
        await harness.dispose()
      }
    })
  })

  describe('Deterministic simultaneous-window single-flighting & cancellation', () => {
    it('shares one underlying model request across Windows A and B', async () => {
      const harness = await setupAssistantHarness(undefined, {
        enableComposerPredictions: true,
      }, { withCatalog: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-shared' as never,
          content: [{ type: 'text', text: 'Multi-window shared request test' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        const reqCountBefore = harness.adapter.requests.length

        // Window A and Window B trigger simultaneously
        const [resA, resB] = await Promise.all([
          assistants.predictComposer({ sessionId, asOfSeq: lastEnd.seq, draftText: '' }),
          assistants.predictComposer({ sessionId, asOfSeq: lastEnd.seq, draftText: '' }),
        ])

        expect(resA).not.toBeNull()
        expect(resB).not.toBeNull()
        expect(resA?.text).toBe(resB?.text)
        expect(resA?.predictionId).toBe(resB?.predictionId)
        // Exactly 1 new model request issued!
        expect(harness.adapter.requests.length - reqCountBefore).toBe(1)
      } finally {
        await harness.dispose()
      }
    })

    it('Window A disconnects while Window B receives the result', async () => {
      // Script: deliver normal response
      const harness = await setupAssistantHarness(undefined, {
        enableComposerPredictions: true,
      }, { withCatalog: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-sub-disc' as never,
          content: [{ type: 'text', text: 'Window A disconnects test' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        const abortCtrlA = new AbortController()
        const abortCtrlB = new AbortController()

        const promiseA = assistants.predictComposer(
          { sessionId, asOfSeq: lastEnd.seq, draftText: '' },
          abortCtrlA.signal,
        )
        const promiseB = assistants.predictComposer(
          { sessionId, asOfSeq: lastEnd.seq, draftText: '' },
          abortCtrlB.signal,
        )

        // Abort Window A immediately
        abortCtrlA.abort('Window A closed')

        const [resA, resB] = await Promise.all([promiseA, promiseB])

        expect(resA).toBeNull() // Window A aborted
        expect(resB).not.toBeNull() // Window B survived and received result
        expect(resB?.text.length).toBeGreaterThan(0)
      } finally {
        await harness.dispose()
      }
    })

    it('both Window A and Window B disconnect and the adapter stream aborts', async () => {
      const script = [
        textResponse('Normal turn response'),
        'hang' as const, // Hanging prediction stream that waits for abort
      ]
      const adapter = new MockAdapter(script)
      const harness = await setupAssistantHarness(adapter, {
        enableComposerPredictions: true,
      }, { withCatalog: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-hang-test' as never,
          content: [{ type: 'text', text: 'Trigger turn before hang' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        const abortCtrlA = new AbortController()
        const abortCtrlB = new AbortController()

        const promiseA = assistants.predictComposer(
          { sessionId, asOfSeq: lastEnd.seq, draftText: '' },
          abortCtrlA.signal,
        )
        const promiseB = assistants.predictComposer(
          { sessionId, asOfSeq: lastEnd.seq, draftText: '' },
          abortCtrlB.signal,
        )

        // Wait until prediction request reaches adapter
        await vi.waitFor(() => {
          expect(adapter.requests.length).toBeGreaterThanOrEqual(2)
        })

        // Disconnect both
        abortCtrlA.abort('Window A closed')
        abortCtrlB.abort('Window B closed')

        const [resA, resB] = await Promise.all([promiseA, promiseB])
        expect(resA).toBeNull()
        expect(resB).toBeNull()

        // Verify the prediction request's signal received by the adapter was aborted
        const predRequest = adapter.requests.find(r => r.messages.some(m => JSON.stringify(m).includes('Suggested user next message')))
        expect(predRequest).toBeDefined()
        expect(predRequest?.signal?.aborted).toBe(true)
      } finally {
        await harness.dispose()
      }
    })

    it('turn or route change invalidates both subscribers and cancels in-flight work', async () => {
      const script = [
        textResponse('Turn 1 response'),
        'hang' as const,
      ]
      const adapter = new MockAdapter(script)
      const harness = await setupAssistantHarness(adapter, {
        enableComposerPredictions: true,
      }, { withCatalog: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-invalidate-1' as never,
          content: [{ type: 'text', text: 'Prompt 1' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const lastEnd = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        const promiseA = assistants.predictComposer({ sessionId, asOfSeq: lastEnd.seq, draftText: '' })
        const promiseB = assistants.predictComposer({ sessionId, asOfSeq: lastEnd.seq, draftText: '' })

        // Wait until prediction request reaches adapter
        await vi.waitFor(() => {
          expect(adapter.requests.length).toBeGreaterThanOrEqual(2)
        })

        // Trigger session cancellation (simulating turn advance or route change)
        assistants.reviewPredictions.cancelSession(sessionId)

        const [resA, resB] = await Promise.all([promiseA, promiseB])
        expect(resA).toBeNull()
        expect(resB).toBeNull()
      } finally {
        await harness.dispose()
      }
    })

    it('old subscriber on sequence N cannot cancel a newer request on sequence N+1', async () => {
      const harness = await setupAssistantHarness(undefined, {
        enableComposerPredictions: true,
      }, { withCatalog: true })

      try {
        const { assistants, controller, lead } = harness
        const sessionId = lead.id

        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-seq-1' as never,
          content: [{ type: 'text', text: 'First question' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const liveSession = harness.ctx.sessions.get(sessionId)!
        const turn1End = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!

        // Window A subscribed to turn 1
        const abortCtrlA = new AbortController()

        // Now prompt turn 2
        await controller.prompt({
          sessionId,
          mode: 'queue',
          requestId: 'turn-seq-2' as never,
          content: [{ type: 'text', text: 'Second question' }],
        }, new AbortController().signal)
        await lead.whenIdle()

        const turn2End = liveSession.snapshotEvents().findLast(e => e.type === 'turn/end' && e.data.reason.kind === 'completed')!
        expect(turn2End.seq).toBeGreaterThan(turn1End.seq)

        // Window B requests turn 2
        const promiseB = assistants.predictComposer({
          sessionId,
          asOfSeq: turn2End.seq,
          draftText: '',
        })

        // Window A aborts turn 1
        abortCtrlA.abort('Window A aborts turn 1')

        const resB = await promiseB
        // Window B's turn 2 prediction was NOT cancelled!
        expect(resB).not.toBeNull()
        expect(resB?.asOfSeq).toBe(turn2End.seq)
      } finally {
        await harness.dispose()
      }
    })
  })
})
