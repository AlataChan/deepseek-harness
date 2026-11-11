/** Real Host persistent-question behavior and recovery scenarios. */
import type { } from '@deepseek-ai/dsh-agent-default-model'
import type { } from '@deepseek-ai/dsh-api-gateway'
import type { } from '@deepseek-ai/dsh-api-session-controller'
import type { } from '@deepseek-ai/dsh-experimental-agent-team'
import type SessionDecisionsService from '@deepseek-ai/dsh-experimental-session-decisions'
import type { DecisionId,DecisionView } from '@deepseek-ai/dsh-experimental-session-decisions/types'
import type { } from '@deepseek-ai/dsh-goal'
import { SessionId } from '@deepseek-ai/dsh-session'
import { chmod,rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect,it } from 'vitest'
import { BUSY_TEAM_DIR,Golden,SCENARIO_DIR,copyRoot,createQuestionSession,durableWorld,enteredUserSources,enteredUserTexts,gatewayInvoke,holdQuestionTurn,installAdapter,latestGoalRevision,launchQuestions,liveAgent,messageTextOf,nextPromptRequestId,promptSession,remoteCatalog,remoteGet,remoteSubmit,settleSession,soleDecision,soleOpenDecision,textChunks,toolCallChunks,toolCalls,toolResults } from './persistent-questions.fixture.ts'
import {
  compareOrRefreshGolden,
  readPersistedEvents,
} from './scaffold.ts'

it('asks through the real question tool and admits the composed choice answer exactly once', async () => {
  const { home, roots } = await durableWorld()
  try {
    const scaffold = await launchQuestions(roots)
    try {
      // Answer-turn script: the model reads the question back through the
      // real read tool (decision id resolved at runtime), then replies.
      const decisionHolder: { id?: DecisionId } = {}
      const adapter = await installAdapter(scaffold, [
        toolCallChunks([{
          id: 'call-ask',
          name: 'request_persistent_question',
          args: { question: 'Deploy the staging build to production?', choices: ['/deploy-prod', 'Hold staging'] },
        }]),
        async () => {
          if (decisionHolder.id === undefined) throw new Error('question identity missing')
          const decisionId = decisionHolder.id
          await expect.poll(async () => (await remoteGet(scaffold, decisionId))?.answerIndex).toBe('admitted')
          return toolCallChunks([{
            id: 'call-read',
            name: 'read_persistent_question',
            args: { decisionId: decisionHolder.id },
          }])
        },
        textChunks('The recorded answer stands; no further prompt is needed.'),
      ])
      const sessionId = await createQuestionSession(scaffold)

      await promptSession(scaffold, sessionId, 'Please ask me about the deployment.')

      const events = await readPersistedEvents(scaffold, SessionId(sessionId))
      const view = await soleDecision(scaffold, sessionId)
      decisionHolder.id = view.decisionId

      // Real public admission over the gateway Remote with the
      // feature-allocated request id.
      const accepted = await remoteSubmit(scaffold, view.decisionId, view.revision, view.requestId, { choiceOrdinal: 2 })
      await settleSession(scaffold, sessionId)
      expect(accepted.outcome).toBe('accepted')

      // Retry classification over the gateway without any second prompt.
      const callsAfterAdmission = adapter.calls.length
      const duplicate = await remoteSubmit(scaffold, view.decisionId, view.revision, view.requestId, { choiceOrdinal: 2 })
      const conflicting = await remoteSubmit(scaffold, view.decisionId, view.revision, view.requestId, { choiceOrdinal: 1 })
      await settleSession(scaffold, sessionId)

      const settled = await remoteGet(scaffold, view.decisionId)
      const settledEvents = await readPersistedEvents(scaffold, SessionId(sessionId))
      const answers = toolResults(settledEvents, 'read_persistent_question')

      const golden = new Golden().decision(view.decisionId).session(sessionId)
      golden.add('question tool call (raw)', toolCalls(events, 'request_persistent_question'))
      golden.add('question tool result (raw)', toolResults(events, 'request_persistent_question'))
      golden.add('gateway Remote catalog after question', view)
      golden.add('read tool call (raw)', toolCalls(settledEvents, 'read_persistent_question'))
      golden.add('read tool result (raw)', answers)
      expect(answers.every(result => !result.body.includes('requestId'))).toBe(true)
      golden.add('gateway Remote status', await gatewayInvoke(scaffold, 'status', {}))
      golden.add('gateway Remote duplicate retry outcome', duplicate.outcome)
      golden.add('gateway Remote conflicting retry outcome', conflicting.outcome === 'rejected' ? conflicting.reason : conflicting.outcome)
      golden.add('gateway Remote get after retries', settled)
      golden.add('scripted model calls consumed', adapter.calls.length)
      golden.add('model calls unchanged across retries', callsAfterAdmission === 3)
      golden.add('entered user texts (raw transcript)', enteredUserTexts(settledEvents))
      golden.add('entered user sources (raw transcript)', enteredUserSources(settledEvents))
      await compareOrRefreshGolden(join(SCENARIO_DIR, 'identity.expected.md'), golden.render(), scaffold.mode)

      // Pinned identity facts beyond the golden: exact composed body,
      // correlation source, one admission, and the choice label that looks
      // like a gesture never becomes a skill invocation.
      expect(enteredUserTexts(settledEvents)).toContain(`Answer to question ${view.decisionId}: option 2`)
      expect(enteredUserSources(settledEvents)).toContainEqual({
        kind: 'user',
        rpcId: view.decisionId,
      })
      expect(settledEvents.some(event =>
        event.type === 'user/message' && event.data.source.kind === 'skill-invocation',
      ), 'the choice label is never treated as a skill gesture').toBe(false)
      expect(settled?.lifecycle, 'record answered').toBe('answered')
      expect(settled?.answerIndex).toBe('admitted')
      expect(adapter.calls.length).toBe(3)
      expect(duplicate.outcome).toBe('admitted')
      expect(conflicting.outcome).toBe('rejected')
    } finally {
      await scaffold.close()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('composes the exact free-text body and rejects invalid payloads without prompting', async () => {
  const { home, roots } = await durableWorld()
  try {
    const scaffold = await launchQuestions(roots)
    try {
      const adapter = await installAdapter(scaffold, [
        toolCallChunks([{
          id: 'call-ask',
          name: 'request_persistent_question',
          args: { question: 'What should the release notes highlight?' },
        }]),
        textChunks('Noted.'),
      ])
      const sessionId = await createQuestionSession(scaffold)
      await promptSession(scaffold, sessionId, 'Ask me about release notes.')
      const view = await soleDecision(scaffold, sessionId)
      const callsBefore = adapter.calls.length

      // Invalid payloads over the gateway: zero ordinal, both fields.
      const zero = await remoteSubmit(scaffold, view.decisionId, view.revision, view.requestId, { choiceOrdinal: 0 })
      const both = await remoteSubmit(scaffold, view.decisionId, view.revision, view.requestId, { choiceOrdinal: 1, text: 'x' })
      const callsAfterRefusals = adapter.calls.length

      const accepted = await remoteSubmit(
        scaffold, view.decisionId, view.revision, view.requestId,
        { text: 'The /deploy-prod gesture semantics stay ordinary here.' },
      )
      await settleSession(scaffold, sessionId)
      const settledEvents = await readPersistedEvents(scaffold, SessionId(sessionId))

      const golden = new Golden().decision(view.decisionId).session(sessionId)
      golden.add('gateway Remote catalog after question', view)
      golden.add('zero-ordinal outcome', zero.outcome === 'rejected' ? zero.reason : zero.outcome)
      golden.add('both-fields outcome', both.outcome === 'rejected' ? both.reason : both.outcome)
      golden.add('model calls unchanged across refusals', callsAfterRefusals === callsBefore)
      golden.add('free-text outcome', accepted.outcome)
      golden.add('entered user texts (raw transcript)', enteredUserTexts(settledEvents))
      golden.add('entered user sources (raw transcript)', enteredUserSources(settledEvents))
      golden.add('scripted model calls consumed', adapter.calls.length)
      await compareOrRefreshGolden(join(SCENARIO_DIR, 'free-text.expected.md'), golden.render(), scaffold.mode)

      expect(enteredUserTexts(settledEvents))
        .toContain(`Answer to question ${view.decisionId}:\nThe /deploy-prod gesture semantics stay ordinary here.`)
      expect(enteredUserSources(settledEvents)).toContainEqual({ kind: 'user', rpcId: view.decisionId })
      expect(zero.outcome).toBe('rejected')
      expect(both.outcome).toBe('rejected')
      expect(callsAfterRefusals).toBe(callsBefore)
      expect(accepted.outcome).toBe('accepted')
      expect(adapter.calls.length).toBe(callsBefore + 1)
    } finally {
      await scaffold.close()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('arms a Goal, disarms on the question, and resumes+completes it through real answer-turn goal tools', async () => {
  const { home, roots } = await durableWorld()
  try {
    const scaffold = await launchQuestions(roots)
    try {
      const goalHolder: { id?: string; revision?: number } = {}
      const adapter = await installAdapter(scaffold, [
        toolCallChunks([{
          id: 'call-ask',
          name: 'request_persistent_question',
          args: { question: 'Continue the migration rounds?' },
        }]),
        toolCallChunks([{
          id: 'call-get-goal',
          name: 'get_goal',
          args: {},
        }]),
        // The question's disarm bumped the revision; resume with the live
        // value the get_goal result just reported.
        async options => toolCallChunks([{
          id: 'call-resume-goal',
          name: 'update_goal',
          args: { goal_id: goalHolder.id, revision: latestGoalRevision(options), action: 'resume' },
        }]),
        // The resume bumped the revision again; complete with the newest one.
        async options => toolCallChunks([{
          id: 'call-complete-goal',
          name: 'update_goal',
          args: { goal_id: goalHolder.id, revision: latestGoalRevision(options), action: 'complete' },
        }]),
        textChunks('The migration rounds are recorded as complete.'),
      ])
      const sessionId = await createQuestionSession(scaffold)
      const agent = liveAgent(scaffold, sessionId)

      // create arms the Goal (goal/index.ts create path).
      const created = scaffold.ctx.goals.create(agent, { objective: 'Finish the migration rounds' })
      goalHolder.id = created.id
      goalHolder.revision = created.revision
      const beforeQuestion = scaffold.ctx.goals.get(agent)
      expect(beforeQuestion?.activation, 'create arms the Goal').toBe('armed')

      await promptSession(scaffold, sessionId, 'Ask me about the migration.')
      const view = await soleDecision(scaffold, sessionId)
      const afterQuestion = await remoteGet(scaffold, view.decisionId)
      const afterQuestionGoal = scaffold.ctx.goals.get(agent)

      // The queued human answer turn drives the REAL update_goal resume and
      // complete; completion stops any further automatic continuation.
      const accepted = await remoteSubmit(
        scaffold, view.decisionId, view.revision, view.requestId, { text: 'Resume the migration rounds.' },
      )
      await settleSession(scaffold, sessionId)
      const settled = await remoteGet(scaffold, view.decisionId)
      const afterAnswerGoal = scaffold.ctx.goals.get(agent)
      const events = await readPersistedEvents(scaffold, SessionId(sessionId))
      const goalResults = toolResults(events, 'update_goal')

      const golden = new Golden().decision(view.decisionId).session(sessionId).goal(created.id)
      golden.add('goal at create (direct service, immediate)', { phase: created.phase, activation: created.activation, revision: created.revision })
      golden.add('goal before question (direct service, immediate)', { phase: beforeQuestion?.phase, activation: beforeQuestion?.activation })
      golden.add('view goalDisarmed after question (gateway get)', afterQuestion?.goalDisarmed)
      golden.add('goal after question (direct service, immediate)', { phase: afterQuestionGoal?.phase, activation: afterQuestionGoal?.activation })
      golden.add('answer submit outcome (gateway submit)', accepted.outcome)
      golden.add('update_goal tool results (raw)', goalResults.map(result => ({ isError: result.isError, body: result.body })))
      golden.add('goal after answer-turn resume+complete (direct service, immediate)', { phase: afterAnswerGoal?.phase, activation: afterAnswerGoal?.activation })
      golden.add('settled gateway Remote get after answer', settled)
      golden.add('scripted model calls consumed', adapter.calls.length)
      await compareOrRefreshGolden(join(SCENARIO_DIR, 'goal.expected.md'), golden.render(), scaffold.mode)

      expect(afterQuestion?.goalDisarmed, 'armed Goal was disarmed by the question').toBe(true)
      expect(goalResults.every(result => !result.isError), 'answer-turn goal tools all succeed').toBe(true)
      expect(afterAnswerGoal?.phase, 'resumed then completed through the real tool path').toBe('complete')
      expect(adapter.calls.length, 'completion stops automatic continuation').toBe(5)
      expect(settled?.lifecycle).toBe('answered')
    } finally {
      await scaffold.close()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('rejects a model resume of a truly paused Goal with GOAL_TOOL_RESUME_PAUSED and stays paused', async () => {
  const { home, roots } = await durableWorld()
  try {
    const scaffold = await launchQuestions(roots)
    try {
      const goalHolder: { id?: string; revision?: number } = {}
      const adapter = await installAdapter(scaffold, [
        toolCallChunks([{
          id: 'call-ask',
          name: 'request_persistent_question',
          args: { question: 'Continue the migration rounds?' },
        }]),
        toolCallChunks([{
          id: 'call-get-goal',
          name: 'get_goal',
          args: {},
        }]),
        // The paused guard requires the exact current revision; read the
        // live value the get_goal result just reported.
        async options => toolCallChunks([{
          id: 'call-resume-paused',
          name: 'update_goal',
          args: { goal_id: goalHolder.id, revision: latestGoalRevision(options), action: 'resume' },
        }]),
        textChunks('Understood; the paused goal stays with you.'),
      ])
      const sessionId = await createQuestionSession(scaffold)
      const agent = liveAgent(scaffold, sessionId)
      const created = scaffold.ctx.goals.create(agent, { objective: 'Finish the migration rounds' })
      goalHolder.id = created.id
      goalHolder.revision = created.revision
      const paused = scaffold.ctx.goals.pause(agent, created)
      expect(paused.phase, 'setup leaves the Goal truly paused').toBe('paused')

      await promptSession(scaffold, sessionId, 'Ask me about the migration.')
      const view = await soleDecision(scaffold, sessionId)
      const viewWhilePaused = await remoteGet(scaffold, view.decisionId)

      const accepted = await remoteSubmit(
        scaffold, view.decisionId, view.revision, view.requestId, { text: 'Resume the migration rounds.' },
      )
      await settleSession(scaffold, sessionId)
      const settled = await remoteGet(scaffold, view.decisionId)
      const afterAnswerGoal = scaffold.ctx.goals.get(agent)
      const events = await readPersistedEvents(scaffold, SessionId(sessionId))
      const goalResults = toolResults(events, 'update_goal')

      const golden = new Golden().decision(view.decisionId).session(sessionId).goal(created.id)
      golden.add('goal at setup pause (direct service, immediate)', { phase: paused.phase, activation: paused.activation, revision: paused.revision })
      golden.add('view goalDisarmed while paused (gateway get)', viewWhilePaused?.goalDisarmed)
      golden.add('answer submit outcome (gateway submit)', accepted.outcome)
      golden.add('update_goal tool results (raw)', goalResults.map(result => ({ isError: result.isError, body: result.body })))
      golden.add('goal after rejected model resume (direct service, immediate)', { phase: afterAnswerGoal?.phase, activation: afterAnswerGoal?.activation })
      golden.add('settled gateway Remote get after answer', settled)
      golden.add('scripted model calls consumed', adapter.calls.length)
      await compareOrRefreshGolden(join(SCENARIO_DIR, 'goal-paused.expected.md'), golden.render(), scaffold.mode)

      expect(viewWhilePaused?.goalDisarmed, 'truly paused Goal is not advertised as disarmed').toBeUndefined()
      // The typed refusal surfaces as GOAL_TOOL_RESUME_PAUSED at the tool
      // boundary; the result body carries the rendered message.
      expect(goalResults.some(result => result.isError
        && result.body.includes('the model cannot resume a paused goal; the user must resume it')),
      'the model resume of a paused Goal is refused with the pinned code').toBe(true)
      expect(afterAnswerGoal?.phase, 'the Goal stays paused after the refused model resume').toBe('paused')
      expect(adapter.calls.length, 'no automatic continuation after the refusal').toBe(4)
      expect(settled?.lifecycle).toBe('answered')
    } finally {
      await scaffold.close()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('expires through the real sweep, refuses late answers, and closes tracking on explicit cancel', async () => {
  const { home, roots } = await durableWorld()
  try {
    const scaffold = await launchQuestions(roots)
    try {
      await installAdapter(scaffold, [
        toolCallChunks([{
          id: 'call-ask',
          name: 'request_persistent_question',
          args: { question: 'Restart the worker pool now?', choices: ['Restart', 'Wait'], ttlMs: 1 },
        }]),
      ])
      const sessionId = await createQuestionSession(scaffold)
      await promptSession(scaffold, sessionId, 'Ask me about the worker pool.')
      const view = await soleDecision(scaffold, sessionId)

      // Real sweep timers own expiry; no clock injection seam exists on the
      // Host service, so the tiny ttl settles through the actual sweeper.
      await expect.poll(async () => (await remoteGet(scaffold, view.decisionId))?.lifecycle, { timeout: 10_000 })
        .toBe('expired')
      const expired = await remoteGet(scaffold, view.decisionId)
      const late = expired === undefined
        ? undefined
        : await remoteSubmit(scaffold, view.decisionId, expired.revision, expired.requestId, { choiceOrdinal: 1 })
      const cancelled = await gatewayInvoke(scaffold, 'cancel', {
        decisionId: view.decisionId,
        expectedRevision: expired?.revision ?? view.revision,
      }) as { ok: boolean; reason?: string }

      const golden = new Golden().decision(view.decisionId).session(sessionId)
      golden.add('gateway Remote catalog after question', view)
      golden.add('view lifecycle after real sweep (gateway get)', expired?.lifecycle)
      golden.add('late answer outcome (gateway submit)', late?.outcome === 'rejected' ? late.reason : late?.outcome)
      golden.add('explicit cancel outcome (gateway cancel)', cancelled.ok ? 'ok' : cancelled.reason)
      await compareOrRefreshGolden(join(SCENARIO_DIR, 'expiry.expected.md'), golden.render(), scaffold.mode)

      expect(expired?.lifecycle).toBe('expired')
      expect(late?.outcome).toBe('rejected')
    } finally {
      await scaffold.close()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('supersedes an open question on ordinary input and never suppresses an accepted answer', async () => {
  const { home, roots } = await durableWorld()
  try {
    const scaffold = await launchQuestions(roots)
    try {
      const adapter = await installAdapter(scaffold, [
        toolCallChunks([{
          id: 'call-ask',
          name: 'request_persistent_question',
          args: { question: 'Rotate the API keys today?', choices: ['Rotate', 'Postpone'] },
        }]),
        textChunks('Understood; the keys are dropped for now.'),
        toolCallChunks([{
          id: 'call-ask-2',
          name: 'request_persistent_question',
          args: { question: 'Archive the old buckets?', choices: ['Archive', 'Keep'] },
        }]),
        textChunks('Answer turn reply.'),
        textChunks('Noted; the recorded answer stands.'),
      ])
      const sessionId = await createQuestionSession(scaffold)

      // Supersede-before-answer: ordinary desktop input while open.
      await promptSession(scaffold, sessionId, 'Ask me about key rotation.')
      const open = await soleDecision(scaffold, sessionId)
      await promptSession(scaffold, sessionId, 'Actually never mind the keys for now.')
      const superseded = await remoteGet(scaffold, open.decisionId)
      const late = superseded === undefined
        ? undefined
        : await remoteSubmit(scaffold, open.decisionId, superseded.revision, superseded.requestId, { choiceOrdinal: 1 })

      // Accepted-then-input: the settled answer is never suppressed and the
      // answered record is not resurrected by later ordinary input.
      await promptSession(scaffold, sessionId, 'Ask me about the buckets instead.')
      const answerView = await soleOpenDecision(scaffold, sessionId)
      expect(answerView.decisionId).not.toEqual(open.decisionId)
      const accepted = await remoteSubmit(
        scaffold, answerView.decisionId, answerView.revision, answerView.requestId, { choiceOrdinal: 2 },
      )
      await settleSession(scaffold, sessionId)
      await promptSession(scaffold, sessionId, 'One more ordinary thought after the answer.')
      const afterInput = await remoteGet(scaffold, answerView.decisionId)
      const settledEvents = await readPersistedEvents(scaffold, SessionId(sessionId))

      const golden = new Golden().decision(open.decisionId).decision(answerView.decisionId).session(sessionId)
      golden.add('view lifecycle after ordinary input (gateway get)', superseded?.lifecycle)
      golden.add('late answer outcome (gateway submit)', late?.outcome === 'rejected' ? late.reason : late?.outcome)
      golden.add('accepted answer outcome (gateway submit)', accepted.outcome)
      golden.add('view lifecycle after later input (gateway get)', afterInput?.lifecycle)
      golden.add('view answerIndex after later input (gateway get)', afterInput?.answerIndex)
      golden.add('entered user texts (raw transcript)', enteredUserTexts(settledEvents))
      golden.add('scripted model calls consumed', adapter.calls.length)
      await compareOrRefreshGolden(join(SCENARIO_DIR, 'supersede.expected.md'), golden.render(), scaffold.mode)

      expect(superseded?.lifecycle).toBe('superseded')
      expect(late?.outcome).toBe('rejected')
      expect(accepted.outcome).toBe('accepted')
      expect(afterInput?.lifecycle, 'answered record stays answered').toBe('answered')
      const texts = enteredUserTexts(settledEvents)
      expect(texts.filter(text => text === `Answer to question ${answerView.decisionId}: option 2`)).toHaveLength(1)
      expect(texts).toContain('One more ordinary thought after the answer.')
    } finally {
      await scaffold.close()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('restores an open question after orderly close with no automatic model turn', async () => {
  const { home, roots } = await durableWorld()
  try {
    const first = await launchQuestions(roots)
    const checkpoint = {
      persistenceRoot: join(home, 'checkpoint-sessions'),
      storageRoot: join(home, 'checkpoint-storage'),
    }
    let sessionId = ''
    try {
      await installAdapter(first, [
        toolCallChunks([{
          id: 'call-ask',
          name: 'request_persistent_question',
          args: { question: 'Enable the beta flag for all workspaces?' },
        }]),
      ])
      sessionId = await createQuestionSession(first)
      await promptSession(first, sessionId, 'Ask me about the beta flag.')
      // Crash-style checkpoint of the flushed caller-owned roots before any
      // disposal; the workspaceCwd is reused, never copied.
      await copyRoot(roots.persistenceRoot, checkpoint.persistenceRoot)
      await copyRoot(roots.storageRoot, checkpoint.storageRoot)
    } finally {
      await first.close()
    }

    const second = await launchQuestions({ ...roots, ...checkpoint })
    try {
      // Fresh script: ANY model call here would be an automatic turn, which
      // the restore contract forbids.
      const adapter = await installAdapter(second, [textChunks('unexpected autonomous turn')])
      const resumed = await second.ctx.agents.resume({
        resumeSessionId: SessionId(sessionId),
        setup: agentCtx => second.ctx.agentPresets.mount(agentCtx, 'persistent-questions').then(() => undefined),
      })
      try {
        await resumed.agent.whenIdle()
        const view = await soleDecision(second, sessionId)
        const events = await readPersistedEvents(second, SessionId(sessionId))
        const callsAtRestore = adapter.calls.length

        // The question stays answerable across the orderly restart.
        const accepted = await remoteSubmit(second, view.decisionId, view.revision, view.requestId, { text: 'Yes, enable it for all workspaces.' })
        await resumed.agent.whenIdle()
        const settled = await remoteGet(second, view.decisionId)

        const golden = new Golden().decision(view.decisionId).session(sessionId)
        golden.add('restored gateway Remote catalog', view)
        golden.add('model calls before any answer', callsAtRestore)
        golden.add('answer outcome after restore (gateway submit)', accepted.outcome)
        golden.add('settled gateway Remote get after restore answer', settled)
        golden.add('entered user texts (raw transcript)', enteredUserTexts(events))
        await compareOrRefreshGolden(join(SCENARIO_DIR, 'orderly-restart.expected.md'), golden.render(), second.mode)

        expect(view.lifecycle).toBe('open')
        expect(view.answerIndex).toBe('none')
        expect(callsAtRestore, 'no automatic model turn on restore').toBe(0)
        expect(accepted.outcome).toBe('accepted')
      } finally {
        await resumed.dispose()
      }
    } finally {
      await second.close()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('restores a queued answer from a crash checkpoint and enters it once after explicit human resume', async () => {
  const { home, roots } = await durableWorld()
  try {
    const first = await launchQuestions(roots)
    const checkpoint = {
      persistenceRoot: join(home, 'checkpoint-sessions'),
      storageRoot: join(home, 'checkpoint-storage'),
    }
    let viewAtCheckpoint: DecisionView | undefined
    let pendingAtCheckpoint: Array<{ id: unknown; text: string }> = []
    try {
      const gate = holdQuestionTurn(first)
      const adapter = await installAdapter(first, [
        toolCallChunks([{
          id: 'call-ask', name: 'request_persistent_question',
          args: { question: 'Bump the rate limit to 200 rps?', choices: ['Bump', 'Keep 100'] },
        }]), textChunks('Answer turn reply.'),
      ])
      const sessionId = await createQuestionSession(first)
      const heldTurn = promptSession(first, sessionId, 'Ask me about the rate limit.')
      heldTurn.catch(() => undefined)
      await gate.saved
      viewAtCheckpoint = await soleDecision(first, sessionId)
      const submitted = await remoteSubmit(
        first, viewAtCheckpoint.decisionId, viewAtCheckpoint.revision, viewAtCheckpoint.requestId, { choiceOrdinal: 1 },
      )
      expect(submitted.outcome).toBe('accepted')
      expect(adapter.calls).toHaveLength(1)
      viewAtCheckpoint = await remoteGet(first, viewAtCheckpoint.decisionId)

      // Checkpoint state: the actual composed answer is pending (not entered)
      // and the record holds its reservation.
      const pendingNow = liveAgent(first, sessionId).inbox.nextTurn.map(message => ({
        id: message.id,
        text: messageTextOf(message),
      }))
      pendingAtCheckpoint = pendingNow
      const eventsAtCheckpoint = await readPersistedEvents(first, SessionId(sessionId))
      expect(enteredUserTexts(eventsAtCheckpoint).some(text => text.startsWith('Answer to question')),
        'the queued answer stays unentered at the checkpoint').toBe(false)
      expect(pendingAtCheckpoint.some(item => item.text === `Answer to question ${viewAtCheckpoint?.decisionId}: option 1`),
        'the real admission queued the composed answer').toBe(true)
      await first.ctx.sessions.flush(liveAgent(first, sessionId).session)

      // Crash-style checkpoint before any disposal.
      await copyRoot(roots.persistenceRoot, checkpoint.persistenceRoot)
      await copyRoot(roots.storageRoot, checkpoint.storageRoot)

      // Let the held turn finish so disposal stays clean; the checkpoint
      // already captured the pending answer and the submitting reservation.
      gate.release()
      await heldTurn
      await settleSession(first, sessionId)
    } finally {
      await first.close()
    }
    expect(viewAtCheckpoint === undefined).toBe(false)
    const second = await launchQuestions({ ...roots, ...checkpoint })
    try {
      const adapter = await installAdapter(second, [textChunks('Restored answer turn reply.')])
      const checkpointView = viewAtCheckpoint
      if (checkpointView === undefined) throw new Error('checkpoint view missing')
      await second.ctx.sessionController.prompt({
        requestId: checkpointView.requestId,
        sessionId: checkpointView.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: `Answer to question ${checkpointView.decisionId}: option 1` }],
      }, new AbortController().signal)
      const resumed = liveAgent(second, checkpointView.sessionId)
      expect(adapter.calls).toHaveLength(0)
      const pendingAnswer = resumed.inbox.nextTurn.find(message =>
        messageTextOf(message) === `Answer to question ${checkpointView.decisionId}: option 1`)
      if (!pendingAnswer) throw new Error('Cold restore did not retain the queued answer')
      // A restored inbox stays parked until an explicit human queue action wakes it.
      await second.ctx.sessionController.prompt({ sessionId: checkpointView.sessionId, requestId: nextPromptRequestId(),
        mode: 'steer', content: [{ type: 'text', text: 'Continue with the saved queued answer.' }],
      }, new AbortController().signal)
      try {
        // The restored pending answer (real composed body, real requestId)
        // enters exactly once and upgrades the reservation; the model is
        // never prompted beyond the single answer turn.
        await expect.poll(async () => (await remoteGet(second, checkpointView.decisionId))?.answerIndex,
          { timeout: 15_000 }).toBe('admitted')
        await resumed.whenIdle()
        const settled = await remoteGet(second, checkpointView.decisionId)
        const events = await readPersistedEvents(second, checkpointView.sessionId)
        const answerText = `Answer to question ${checkpointView.decisionId}: option 1`

        const golden = new Golden().decision(checkpointView.decisionId).session(checkpointView.sessionId)
        golden.add('checkpoint view answerIndex (gateway get)', checkpointView.answerIndex)
        golden.add('pending queue at checkpoint (direct inbox read)',
          pendingAtCheckpoint.map(item => ({ text: item.text })))
        golden.add('settled gateway Remote get after restore', settled)
        golden.add('entered user texts (raw transcript)', enteredUserTexts(events))
        golden.add('entered user sources (raw transcript)', enteredUserSources(events))
        golden.add('model calls on restart (only the answer turn)', adapter.calls.length)
        await compareOrRefreshGolden(join(SCENARIO_DIR, 'crash-pending.expected.md'), golden.render(), second.mode)

        expect(enteredUserTexts(events).filter(text => text === answerText)).toHaveLength(1)
        expect(enteredUserSources(events)).toContainEqual({
          kind: 'user',
          rpcId: checkpointView.requestId,
        })
        expect(adapter.calls.length, 'no extra model turn beyond the answer').toBe(1)
        expect(settled?.lifecycle).toBe('superseded')
      } finally {
        resumed.cancel({ kind: 'user' })
      }
    } finally {
      await second.close()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('classifies an entered answer whose index commit crashed on restart without a second admission', async () => {
  const { home, roots } = await durableWorld()
  // The decision medium is the single-unit JSON file for the
  // `session_decisions` domain (no per-record layout declared). The
  // answer-turn script flips it read-only AFTER the reservation, so the
  // reservation put succeeds, the composed user/message enters durably, and
  // only the answer-index commit fails — the exact transcript/record
  // disagreement a crash between entry and commit leaves behind.
  const decisionMedium = roots.storageRoot
  let submitNote: { submitOutcome: unknown; answerIndexAtCheckpoint: unknown } | undefined
  try {
    const first = await launchQuestions(roots)
    const checkpoint = {
      persistenceRoot: join(home, 'checkpoint-sessions'),
      storageRoot: join(home, 'checkpoint-storage'),
    }
    let viewAtCheckpoint: DecisionView | undefined
    try {
      await installAdapter(first, [
        toolCallChunks([{
          id: 'call-ask',
          name: 'request_persistent_question',
          args: { question: 'Switch the default theme to system?', choices: ['Switch', 'Keep light'] },
        }]),
        textChunks('Answer turn reply.'),
      ])
      const sessionId = await createQuestionSession(first)
      await promptSession(first, sessionId, 'Ask me about the theme.')
      viewAtCheckpoint = await soleDecision(first, sessionId)
      const answerRequestId = viewAtCheckpoint.requestId
      first.ctx.on('agent/pre-step', async (payload, next) => {
        if (payload.messages.some(message => message.source.kind === 'user' &&
          'rpcId' in message.source && message.source.rpcId === answerRequestId)) {
          await chmod(decisionMedium, 0o500)
        }
        return next()
      })
      const outcome = await remoteSubmit(
        first, viewAtCheckpoint.decisionId, viewAtCheckpoint.revision, viewAtCheckpoint.requestId, { choiceOrdinal: 1 },
      ).catch((error: unknown) => ({ outcome: `submit threw: ${error instanceof Error ? error.message : String(error)}` }))
      await settleSession(first, sessionId)
      await chmod(decisionMedium, 0o700)
      viewAtCheckpoint = await remoteGet(first, viewAtCheckpoint.decisionId)

      // The transcript/record disagreement: the composed answer entered
      // durably, the answer index never committed.
      const eventsAtCheckpoint = await readPersistedEvents(first, SessionId(sessionId))
      const answerText = `Answer to question ${viewAtCheckpoint?.decisionId}: option 1`
      expect(enteredUserTexts(eventsAtCheckpoint).filter(text => text === answerText)).toHaveLength(1)
      expect(viewAtCheckpoint?.answerIndex, 'index commit did not land before the crash')
        .not.toBe('admitted')

      // Crash-style checkpoint before any disposal: the copy holds the
      // entered answer plus the uncommitted record, before teardown can
      // degrade the reservation.
      await copyRoot(roots.persistenceRoot, checkpoint.persistenceRoot)
      await copyRoot(roots.storageRoot, checkpoint.storageRoot)
      submitNote = { submitOutcome: outcome, answerIndexAtCheckpoint: viewAtCheckpoint?.answerIndex }
    } finally {
      await chmod(decisionMedium, 0o700).catch(() => undefined)
      await first.close()
    }

    // Search-disabled composition: restart must classify the durable entered
    // answer on exact evidence only — admitted, no second admission, no
    // second prompt.
    const second = await launchQuestions({ ...roots, ...checkpoint }, { sessionSearch: 'never' })
    try {
      const adapter = await installAdapter(second, [])
      const checkpointView = viewAtCheckpoint
      if (checkpointView === undefined || checkpointView.requestId === undefined) {
        throw new Error('checkpoint view missing')
      }
      const resumed = await second.ctx.agents.resume({
        resumeSessionId: checkpointView.sessionId,
        setup: agentCtx => second.ctx.agentPresets.mount(agentCtx, 'persistent-questions').then(() => undefined),
      })
      try {
        await resumed.agent.whenIdle()
        const duplicate = await remoteSubmit(
          second, checkpointView.decisionId, checkpointView.revision, checkpointView.requestId, { choiceOrdinal: 1 },
        )
        const conflicting = await remoteSubmit(
          second, checkpointView.decisionId, checkpointView.revision, checkpointView.requestId, { choiceOrdinal: 2 },
        )
        await resumed.agent.whenIdle()
        const events = await readPersistedEvents(second, checkpointView.sessionId)
        const answerText = `Answer to question ${checkpointView.decisionId}: option 1`

        const golden = new Golden().decision(checkpointView.decisionId).session(checkpointView.sessionId)
        golden.add('submit outcome across failed index commit', submitNote?.submitOutcome)
        golden.add('answer index at checkpoint', submitNote?.answerIndexAtCheckpoint)
        golden.add('gateway Remote duplicate retry outcome on restart', duplicate.outcome)
        golden.add('gateway Remote conflicting retry outcome on restart',
          conflicting.outcome === 'rejected' ? conflicting.reason : conflicting.outcome)
        golden.add('model calls on restart', adapter.calls.length)
        golden.add('entered user texts (raw transcript)', enteredUserTexts(events))
        await compareOrRefreshGolden(join(SCENARIO_DIR, 'crash-entered.expected.md'), golden.render(), second.mode)

        expect(duplicate.outcome, 'no second prompt for the entered answer').toBe('admitted')
        expect(conflicting.outcome).toBe('rejected')
        expect(adapter.calls.length, 'restart runs no model turn').toBe(0)
        expect(enteredUserTexts(events).filter(text => text === answerText)).toHaveLength(1)
      } finally {
        await resumed.dispose()
      }
    } finally {
      await second.close()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it.each(['edit', 'remove', 'steer'] as const)('applies the real %s queue mutation to an answer behind its producing turn', async (action) => {
  const { home, roots } = await durableWorld()
  const scaffold = await launchQuestions(roots)
  const gate = holdQuestionTurn(scaffold)
  try {
    const adapter = await installAdapter(scaffold, [
      toolCallChunks([{ id: 'call-ask', name: 'request_persistent_question',
        args: { question: 'Rotate the API keys today?', choices: ['Rotate', 'Postpone'] } }]),
      textChunks('Your answer was received.'),
    ])
    const sessionId = await createQuestionSession(scaffold)
    const producingTurn = promptSession(scaffold, sessionId, 'Ask me about key rotation.')
    producingTurn.catch(() => undefined)
    await gate.saved
    const view = await soleDecision(scaffold, sessionId)
    const submitted = await remoteSubmit(scaffold, view.decisionId, view.revision, view.requestId, { choiceOrdinal: 2 })
    expect(submitted.outcome).toBe('accepted')
    const queued = liveAgent(scaffold, sessionId).inbox.nextTurn.find(message =>
      messageTextOf(message) === `Answer to question ${view.decisionId}: option 2`)
    if (!queued) throw new Error('Answer was not queued behind its producing turn')
    const editedText = `Edited answer for ${view.decisionId}: postpone.`
    await scaffold.ctx.sessionController.updateQueue({ sessionId: SessionId(sessionId), itemId: queued.id,
      action: action === 'edit' ? { kind: 'edit', content: [{ type: 'text', text: editedText }] } : { kind: action } })
    gate.release()
    await producingTurn
    await settleSession(scaffold, sessionId)
    await expect.poll(async () => (await remoteGet(scaffold, view.decisionId))?.answerIndex).toBe(action === 'remove' ? 'withdrawn' : 'admitted')
    const after = await remoteGet(scaffold, view.decisionId)
    const retry = await remoteSubmit(scaffold, view.decisionId, after?.revision ?? view.revision, view.requestId, { choiceOrdinal: 2 })
    const events = await readPersistedEvents(scaffold, SessionId(sessionId))
    if (action === 'remove') {
      expect(after?.answerIndex).toBe('withdrawn')
      expect(retry.outcome).toBe('withdrawn')
      expect(adapter.calls).toHaveLength(1)
    } else {
      expect(after?.answerIndex).toBe('admitted')
      expect(enteredUserTexts(events).filter(text => text === (action === 'edit' ? editedText :
        `Answer to question ${view.decisionId}: option 2`))).toHaveLength(1)
      expect(retry.outcome).toBe(action === 'edit' ? 'rejected' : 'admitted')
    }
    const golden = new Golden().session(sessionId).decision(view.decisionId)
    golden.add('submitted answer', submitted.outcome)
    golden.add('question after queue mutation', after)
    golden.add('duplicate answer', retry.outcome)
    golden.add('entered human texts', enteredUserTexts(events))
    await compareOrRefreshGolden(join(SCENARIO_DIR, `queue-${action}.expected.md`), golden.render(), scaffold.mode)
  } finally {
    gate.release()
    await scaffold.close()
    await rm(home, { recursive: true, force: true })
  }
})

it('degrades an interrupted reservation at teardown and never replays it after restart', async () => {
  const { home, roots } = await durableWorld()
  try {
    let sessionId = ''
    let viewAtReserve: DecisionView | undefined
    const first = await launchQuestions(roots)
    try {
      await installAdapter(first, [
        toolCallChunks([{
          id: 'call-ask',
          name: 'request_persistent_question',
          args: { question: 'Purge the stale cache entries?' },
        }]),
      ])
      sessionId = await createQuestionSession(first)
      await promptSession(first, sessionId, 'Ask me about the cache.')
      viewAtReserve = await soleDecision(first, sessionId)

      // Admission interruption through the public trusted path: a failing
      // beforePrompt hook leaves the reservation unresolved, unprompted.
      const interrupted = await (first.ctx.get('sessionDecisions') as SessionDecisionsService).admitAnswer(
        viewAtReserve.decisionId, viewAtReserve.revision, { text: 'Yes, purge the stale entries.' },
        async () => { throw new Error('injected beforePrompt failure') },
      )
      expect(interrupted.outcome).toBe('submitting')
      const events = await readPersistedEvents(first, SessionId(sessionId))
      expect(enteredUserTexts(events).some(text => text.startsWith('Answer to question'))).toBe(false)
    } finally {
      // Graceful close: teardown settlement degrades the unresolved
      // reservation durably on the caller-owned roots.
      await first.close()
    }

    const second = await launchQuestions(roots)
    try {
      const adapter = await installAdapter(second, [])
      const resumed = await second.ctx.agents.resume({
        resumeSessionId: SessionId(sessionId),
        setup: agentCtx => second.ctx.agentPresets.mount(agentCtx, 'persistent-questions').then(() => undefined),
      })
      try {
        const view = await soleDecision(second, sessionId)
        const replay = await remoteSubmit(
          second, view.decisionId, view.revision, view.requestId, { text: 'Yes, purge the stale entries.' },
        )
        const golden = new Golden().decision(view.decisionId).session(sessionId)
        golden.add('restored gateway Remote catalog answerIndex', view.answerIndex)
        golden.add('gateway Remote replay outcome after restart',
          replay.outcome === 'rejected' ? replay.reason : replay.outcome)
        golden.add('model calls on restart', adapter.calls.length)
        await compareOrRefreshGolden(join(SCENARIO_DIR, 'interrupted.expected.md'), golden.render(), second.mode)

        expect(view.answerIndex, 'degraded reservation survives restart').toBe('needs_reconciliation')
        expect(replay.outcome === 'rejected' || replay.outcome === 'reconciliation_required').toBe(true)
        expect(adapter.calls.length, 'no replay prompt').toBe(0)
      } finally {
        await resumed.dispose()
      }
    } finally {
      await second.close()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('recovers a failed supersede write from durable human input without admitting a stale answer', async () => {
  const { home, roots } = await durableWorld()
  // The decision table directory holds one temp+rename unit per record;
  // removing its write permission makes exactly the async supersede put
  // fail while the session log (separate root) stays durable.
  const decisionMedium = roots.storageRoot
  let sessionId = ''
  try {
    const scaffold = await launchQuestions(roots)
    try {
      await installAdapter(scaffold, [
        toolCallChunks([{
          id: 'call-ask',
          name: 'request_persistent_question',
          args: { question: 'Delete the unused sandbox?' },
        }]),
        textChunks('Ordinary reply after your input.'),
      ])
      sessionId = await createQuestionSession(scaffold)
      await promptSession(scaffold, sessionId, 'Ask me about the sandbox.')

      // Ordinary input persists; the async supersede write fails on the
      // read-only decision table and the record stays durably open.
      await chmod(decisionMedium, 0o500)
      await promptSession(scaffold, sessionId, 'Forget the sandbox question entirely.')
      await chmod(decisionMedium, 0o700)

      const inProcess = await remoteGet(scaffold, (await soleDecision(scaffold, sessionId)).decisionId)
      // The durable record stayed open, which only a restart can observe.
      expect(inProcess?.lifecycle, 'in-process record stays open after failed supersede').toBe('open')
      await scaffold.close()
    } finally {
      await chmod(decisionMedium, 0o700).catch(() => undefined)
    }

    // Cold restart over the same flushed roots: the stale open question must
    // NOT become answerable.
    const second = await launchQuestions(roots)
    try {
      const adapter = await installAdapter(second, [textChunks('stale admission reply')])
      const resumed = await second.ctx.agents.resume({
        resumeSessionId: SessionId(sessionId),
        setup: agentCtx => second.ctx.agentPresets.mount(agentCtx, 'persistent-questions').then(() => undefined),
      })
      try {
        const view = await soleDecision(second, sessionId)
        const events = await readPersistedEvents(second, SessionId(sessionId))
        expect(enteredUserTexts(events)).toContain('Forget the sandbox question entirely.')
        const answer = await remoteSubmit(second, view.decisionId, view.revision, view.requestId, { text: 'Yes, delete the sandbox.' })
        await resumed.agent.whenIdle()

        // DESIRED behavior (B0 authority): the stale open question is not
        // answerable after reboot. Current source admits it — this probe
        // stays red until the feature owner adds the durable closure.
        expect(view.lifecycle, 'durable human input supersedes the question on restart').toBe('superseded')
        expect(answer.outcome, 'stale open question must not admit answers after restart')
          .toBe('rejected')
        expect(adapter.calls.length, 'no admission prompt for stale context').toBe(0)
      } finally {
        await resumed.dispose()
      }
    } finally {
      await second.close()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('refuses the question while a Team teammate runs and recovers when it settles', async () => {
  const { home, roots } = await durableWorld()
  try {
    const scaffold = await launchQuestions(roots, { withAgentTeam: true })
    try {
      const releaseTeammate = Promise.withResolvers<undefined>()
      const adapter = await installAdapter(scaffold, [
        // Teammate turn: held open on a gated stream while the Lead asks.
        async () => {
          await releaseTeammate.promise
          return textChunks('Teammate first reply.')
        },
        toolCallChunks([{
          id: 'call-ask',
          name: 'request_persistent_question',
          args: { question: 'Which region should the probe target?', choices: ['eu-central', 'us-east'] },
        }]),
        textChunks('Noted the refusal.'),
        textChunks('Teammate report noted.'),
        toolCallChunks([{
          id: 'call-ask-2',
          name: 'request_persistent_question',
          args: { question: 'Which region should the probe target?', choices: ['eu-central', 'us-east'] },
        }]),
      ])
      const sessionId = await createQuestionSession(scaffold)
      const lead = liveAgent(scaffold, sessionId)
      const teams = scaffold.ctx.get('agentTeams')
      expect(teams, 'agent-team service mounted').toBeDefined()
      const teammate = await teams?.spawnTeammate(lead, {
        name: 'scout',
        description: 'Runs the gated probe sweep',
        prompt: [{ type: 'text', text: 'Sweep the probe targets.' }],
        context: 'fresh',
        provider: 'spawn',
        signal: new AbortController().signal,
      })
      expect(teammate?.member.status, 'teammate runs while its stream is gated').toBe('running')
      expect(adapter.calls.length, 'teammate model call is the gated stream').toBe(1)

      await promptSession(scaffold, sessionId, 'Ask me about the probe target.')
      const eventsWhileBusy = await readPersistedEvents(scaffold, SessionId(sessionId))
      const busyResults = toolResults(eventsWhileBusy, 'request_persistent_question')
      const catalogWhileBusy = await remoteCatalog(scaffold, sessionId)

      releaseTeammate.resolve(undefined)
      await expect.poll(async () => teams?.listMembers(lead).every(member =>
        member.id === lead.id || member.status !== 'running'), { timeout: 15_000 }).toBe(true)
      await expect.poll(() => adapter.calls.length).toBe(4)
      await settleSession(scaffold, sessionId)

      await promptSession(scaffold, sessionId, 'Retry the question now that the sweep settled.')
      const view = await soleDecision(scaffold, sessionId)

      const golden = new Golden().decision(view.decisionId).session(sessionId)
      golden.add('teammate status while gated', teammate?.member.status)
      golden.add('busy refusal result bodies (raw)', busyResults.map(result => result.body))
      golden.add('gateway Remote catalog while busy', catalogWhileBusy)
      golden.add('gateway Remote catalog after teammate settled', view)
      await compareOrRefreshGolden(join(BUSY_TEAM_DIR, 'busy-team.expected.md'), golden.render(), scaffold.mode)

      // The typed refusal surfaces as DECISION_BUSY_OWNED_WORK at the
      // service boundary (root-eligibility.ts); the tool result carries the
      // rendered message with the pinned ORDINARY_CHAT_FALLBACK sentence.
      expect(busyResults.some(result => result.isError
        && result.body.includes('A Team teammate is still running or provisioning')
        && result.body.includes('Ask the user in ordinary chat instead, or retry after owned work has settled.'))).toBe(true)
      expect(catalogWhileBusy).toHaveLength(0)
      expect(view.lifecycle).toBe('open')
    } finally {
      await scaffold.close()
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
