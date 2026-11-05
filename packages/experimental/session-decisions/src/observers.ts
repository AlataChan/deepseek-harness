/**
 * Host-owned event observers for the session-decisions feature: they own
 * producing-step identity capture, the armed deny-all question guard, and
 * input-ordering fact settlement (pending, claimed, entered, discarded,
 * agent-gone). Everything rides public `session/event` and agent inbox
 * notifications; no private session folds.
 *
 * Guard lifecycle (B0): armed after a question is durably saved, reset only
 * by the matching producing step/end, the producing turn/end, or agent
 * disposal, or a non-correlated authenticated human claim.
 *
 * Queue observation: durable `agent/inbox/spliced` events carry inserted
 * messages and the removed count, so observers track each reserved answer's
 * pending message ID and text from its insert. A correlated insert that
 * removed its predecessor is a queue EDIT: the replacement is the durable
 * answer (the tracked text digest follows it through `updateAnswerDigest`,
 * so an original-payload retry conflicts), and the splice's follow-up
 * discard of the predecessor is consumed once instead of settling
 * `withdrawn` — the replacement is still queued (B0 queue oracle 2). A
 * genuine removal discards normally. Any non-correlated insert — user
 * composer input, Schedule, Team, background, or Goal — supersedes the
 * session's open question; a failed supersede write is reported to the
 * owner so in-process admission closes too. A claim removes its message
 * just before the claim notification, so the transient `claimed` fact
 * lands right after the absence fact and the resolver's precedence
 * (claimed → submitting) settles the cycle honestly.
 * @module @deepseek-ai/dsh-experimental-session-decisions/observers
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, MessageId, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionEventMap, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { digestOf, type DecisionStore } from './store.ts'
import type { DecisionAnswerPointer, DecisionFacts, DecisionId, DecisionRecord } from './types.ts'

/** Producing-step identity of one observed tool call. */
export interface ProducingStepIdentity {
  readonly turn: number
  readonly step: number
  readonly callId: string
}

/** Model-facing denial reason for the armed question guard. */
const GUARD_REASON =
  'A persistent question was just asked; the turn ends here so the user can answer. Do not call further tools until the answer arrives.'

/** The request ID of a user-source message, when it carries one. */
function userRpcId(message: UserMessage): SessionRequestId | undefined {
  const source = message.source
  if (source.kind !== 'user' || !('rpcId' in source)) return undefined
  return source.rpcId
}

/** The model-facing text of a message: its text blocks, in order. */
function messageText(message: UserMessage): string {
  return message.content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

type ReservedDecisionRecord = DecisionRecord & { readonly answer: DecisionAnswerPointer }

function hasReservedAnswer(record: DecisionRecord | undefined): record is ReservedDecisionRecord {
  return record !== undefined && record.answer !== null
}

/** One tracked reserved answer waiting in a live inbox. */
interface PendingAnswer {
  readonly sessionId: SessionId
  readonly messageId: MessageId
  /** Text digest of the tracked message: edit detection compares against it. */
  readonly textDigest: string
}

/**
 * One host-wide observer bundle owned by the session-decisions service.
 * Constructed once the store is operational; `dispose()` unwinds every
 * subscription, cache entry, and armed guard.
 */
export class DecisionObservers {
  /**
   * Current producing step per session, from `step/start`..`step/end`,
   * bound to the Agent incarnation that owned the step: a late old-incarnation
   * disposal must not clear a replacement's producing caches.
   */
  private readonly producingSteps = new Map<SessionId, {
    agent: Agent | undefined
    turn: number
    step: number
    generation: number
    calls: Set<string>
  }>()
  /** Armed question guards per session, bound to the exact arming Agent. */
  private readonly guards = new Map<SessionId, { disposer: () => void; turn: number; step: number; agent: Agent }>()
  /** Claim boundary of each in-flight claimed answer, scoped to its session. */
  private readonly claimedTurns = new Map<DecisionId, { sessionId: SessionId; turn: number }>()
  /** Correlated answer messages currently tracked in a live inbox. */
  private readonly pendingAnswers = new Map<DecisionId, PendingAnswer>()
  /**
   * Reserved answers whose tracked message was just re-inserted by a
   * removing splice (a queue edit): the NEXT correlated discard — the
   * splice's predecessor notification — is consumed once and ignored,
   * because the replacement is still queued.
   */
  private readonly editConsumed = new Set<DecisionId>()
  /**
   * Synchronous observed-input generation per session: bumped before every
   * awaited supersede write, so `create` can detect in-flight ordinary
   * input that races its save and refuse instead of concluding the turn on
   * a superseded question.
   */
  private readonly inputGeneration = new Map<SessionId, number>()
  /** Latest announced Agent per session: facts bind to the current incarnation. */
  private readonly currentAgents = new Map<SessionId, Agent>()
  private readonly disposers: Array<() => void> = []

  constructor(
    private readonly ctx: Context,
    private readonly store: () => DecisionStore | undefined,
    private readonly settle: (decisionId: DecisionId, facts: DecisionFacts) => void,
    /**
     * Invoked when a supersede write after ordinary input failed durably:
     * the owner closes in-process admission for the record, because the
     * stale question stayed open.
     */
    private readonly onSupersedeFailed: (decisionId: DecisionId) => void,
  ) {}

  /** Subscribe host-wide and cold-inspect every already-live agent. */
  start(): void {
    this.disposers.push(
      this.ctx.on('session/event', (session, event) => { this.onSessionEvent(session, event) }),
      this.ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => { this.onClaimed(agent, message, turn) }),
      this.ctx.on('agent/inbox/discarded', ({ agent, message }) => { this.onDiscarded(agent, message) }),
      this.ctx.on('agent/created', ({ agent }) => {
        this.currentAgents.set(agent.session.id, agent)
        this.inspectPending(agent)
      }),
      this.ctx.on('agent/disposed', ({ agent }) => { this.onDisposed(agent) }),
    )
    for (const agent of this.ctx.agents.list()) {
      this.currentAgents.set(agent.session.id, agent)
      this.inspectPending(agent)
    }
  }

  /** Unsubscribe everything, drop caches, and disarm every guard. */
  dispose(): void {
    for (const dispose of this.disposers.splice(0).reverse()) dispose()
    for (const guard of this.guards.values()) guard.disposer()
    this.guards.clear()
    this.producingSteps.clear()
    this.claimedTurns.clear()
    this.pendingAnswers.clear()
    this.editConsumed.clear()
    this.inputGeneration.clear()
    this.currentAgents.clear()
  }

  /**
   * Producing-step identity of one observed tool call, when this exact call
   * was seen as a `tool/call` inside the currently open producing step.
   * Missing identity refuses without writing: the guard would have no
   * reliable reset boundary.
   * @param sessionId - Asking Session identity.
   * @param callId - Tool call identity in the producing step.
   * @returns Identity when the tool call belongs to the observed producing step.
   */
  producingIdentity(sessionId: SessionId, callId: string): ProducingStepIdentity | undefined {
    const step = this.producingSteps.get(sessionId)
    if (step === undefined) return undefined
    if (!step.calls.has(callId)) return undefined
    return { turn: step.turn, step: step.step, callId }
  }

  /**
   * The observed-input generation this session's open producing step
   * captured at `step/start` — the context the model is answering. A
   * `create` whose baseline differs refuses the stale response. `undefined`
   * when no producing step is open (non-tool callers compare against the
   * generation at their own entry instead).
   * @param sessionId - Asking Session identity.
   * @returns Input generation captured by the open producing step, when observed.
   */
  stepGeneration(sessionId: SessionId): number | undefined {
    return this.producingSteps.get(sessionId)?.generation
  }

  /**
   * Arm the session's deny-all question guard for the producing step.
   * Monotonic: an already-armed guard is kept (never re-registered or
   * narrowed); producing-step completion, disposal, or a new human claim resets it.
   * @param agent - Agent owning the producing step.
   * @param identity - Observed producing-step identity.
   */
  armProducingGuard(agent: Agent, identity: ProducingStepIdentity): void {
    if (this.guards.has(agent.session.id)) return
    const disposer = agent.ctx.get('tools')?.guard(() => GUARD_REASON)
    if (disposer === undefined) return
    this.guards.set(agent.session.id, { disposer, turn: identity.turn, step: identity.step, agent })
  }

  /**
   * The session's synchronous observed-input generation. `create` compares
   * it across its awaited save: a bump means ordinary input (user, Schedule,
   * Team, background, or Goal) arrived mid-save and the question must be
   * refused rather than concluded. `undefined` while observers are absent.
   * @param sessionId - Asking Session identity.
   * @returns Latest observed input generation, when available.
   */
  observedGeneration(sessionId: SessionId): number | undefined {
    return this.inputGeneration.get(sessionId)
  }

  /** Durable-session observer: entry evidence, queue splices, step/turn boundaries. */
  private onSessionEvent(session: Session, event: SessionEvent): void {
    const sessionId = session.id
    switch (event.type) {
      case 'user/message': {
        const rpcId = userRpcId(event.data)
        if (rpcId !== undefined) this.onEntered(sessionId, rpcId)
        return
      }
      case 'agent/inbox/spliced': {
        this.onSpliced(session, event.data)
        return
      }
      case 'tool/call': {
        const current = this.producingSteps.get(sessionId)
        if (current === undefined || current.turn !== event.data.turn || current.step !== event.data.step) return
        current.calls.add(event.data.callId)
        return
      }
      case 'step/start': {
        this.producingSteps.set(sessionId, {
          agent: this.ctx.get('agents')?.get(sessionId),
          turn: event.data.turn,
          step: event.data.step,
          generation: this.inputGeneration.get(sessionId) ?? 0,
          calls: new Set<string>(),
        })
        return
      }
      case 'step/end': {
        const current = this.producingSteps.get(sessionId)
        if (current?.turn === event.data.turn && current.step === event.data.step) {
          this.producingSteps.delete(sessionId)
        }
        this.resetGuard(sessionId, event.data.turn, event.data.step)
        this.settleClaimed(sessionId, event.data.turn)
        return
      }
      case 'turn/end': {
        this.producingSteps.delete(sessionId)
        this.resetGuard(sessionId, event.data.turn)
        this.settleClaimed(sessionId, event.data.turn)
        return
      }
      default:
    }
  }

  /**
   * One durable inbox splice. Correlated inserts re-observe pending and
   * update tracking; when such an insert removed its tracked predecessor
   * (`removedCount > 0`) it is a queue EDIT: the tracked text digest must
   * follow the replacement (a changed digest rewrites the reserved
   * answer's retry-conflict digest, so an original-payload retry
   * conflicts), and the splice's follow-up discard of the predecessor is
   * consumed once — the replacement is still queued. Any non-correlated
   * insert supersedes the session's open question; a failed supersede
   * write is reported to the owner. The generation bump happens
   * synchronously, before the awaited supersede write, so a racing
   * `create` observes it.
   */
  private onSpliced(session: Session, splice: SessionEventMap['agent/inbox/spliced']): void {
    const sessionId = session.id
    const removedCount = splice.removedCount ?? 0
    let supersede: DecisionId | undefined
    for (const message of splice.inserted) {
      const record = this.recordFor(message, sessionId)
      if (record !== undefined) {
        const digest = digestOf({ text: messageText(message) })
        const prior = this.pendingAnswers.get(record.decisionId)
        if (prior !== undefined && removedCount > 0) {
          // Queue edit of a tracked answer: the replacement is what
          // remains queued. A changed text digest makes the durable
          // answer the replacement's payload; the predecessor's discard
          // notification is consumed, never settled as withdrawal.
          if (prior.textDigest !== digest) {
            const replacement = digest
            const store = this.store()
            if (store !== undefined) {
              void store.updateAnswerDigest(record.decisionId, replacement).catch((error: unknown) => {
                this.ctx.logger.error('session-decisions: answer digest edit-follow failed for %s: %s',
                  record.decisionId, error instanceof Error ? error.message : String(error))
              })
            }
          }
          this.editConsumed.add(record.decisionId)
        }
        this.pendingAnswers.set(record.decisionId, { sessionId, messageId: message.id, textDigest: digest })
        this.apply(record.decisionId, { pending: true })
        continue
      }
      this.inputGeneration.set(sessionId, (this.inputGeneration.get(sessionId) ?? 0) + 1)
      const open = this.store()?.openOfSession(sessionId)
      if (open !== undefined && open.lifecycle === 'open') supersede = open.decisionId
    }
    if (supersede !== undefined) {
      const store = this.store()
      if (store !== undefined) {
        void store.supersede(supersede).catch((error: unknown) => {
          this.ctx.logger.warn('session-decisions: supersede after ordinary input failed for %s: %s',
            supersede, error instanceof Error ? error.message : String(error))
          this.onSupersedeFailed(supersede)
        })
      }
    }
    this.detectAbsence(session)
  }

  /**
   * Re-observe the retained inbox reader: tracked messages no longer pending lost their queue slot.
   * A throw from that reader is not absence evidence, so the reservation stays `submitting`.
   */
  private detectAbsence(session: Session): void {
    if (this.pendingAnswers.size === 0) return
    const agent = this.ctx.get('agents')?.get(session.id)
    if (agent === undefined) return
    let live: Set<MessageId>
    try {
      live = new Set([...agent.inbox.nextTurn, ...agent.inbox.nextStep].map(message => message.id))
    } catch (error: unknown) {
      this.ctx.logger.warn('session-decisions: inbox projection is not observable for %s: %s',
        session.id, error instanceof Error ? error.message : String(error))
      return
    }
    for (const [decisionId, pending] of this.pendingAnswers) {
      if (pending.sessionId !== session.id || live.has(pending.messageId)) continue
      this.pendingAnswers.delete(decisionId)
      const record = this.store()?.get(decisionId)
      if (record === undefined || record.answer === null) continue
      if (record.answerIndex === 'admitted' || record.answerIndex === 'dismissed'
        || record.answerIndex === 'withdrawn') continue
      this.apply(decisionId, { discarded: true })
    }
  }

  /** A claimed answer message: transient claim fact plus its settlement boundary. */
  private onClaimed(agent: Agent, message: UserMessage, turn: number): void {
    const record = this.recordFor(message, agent.session.id)
    if (record === undefined) {
      const guard = this.guards.get(agent.session.id)
      if (message.source.kind === 'user' && guard?.agent === agent) {
        guard.disposer()
        this.guards.delete(agent.session.id)
      }
      return
    }
    this.claimedTurns.set(record.decisionId, { sessionId: agent.session.id, turn })
    this.apply(record.decisionId, { claimed: true })
  }

  /**
   * A canceled-splice discard: the answer left the inbox without entering.
   * A discard that follows an edit splice is the edit's predecessor
   * notification and is consumed once — the replacement is still queued.
   */
  private onDiscarded(agent: Agent, message: UserMessage): void {
    const record = this.recordFor(message, agent.session.id)
    if (record === undefined) return
    if (this.editConsumed.delete(record.decisionId)) return
    this.pendingAnswers.delete(record.decisionId)
    this.apply(record.decisionId, { discarded: true })
  }

  /**
   * Whether one record's answer is currently claimed into an unsettled
   * turn: the claim boundary has not seen its step/turn end yet. The
   * prompt-throw classification consults this so an in-flight claim is
   * never misclassified as reconciliation.
   * @param decisionId - Saved question identity.
   * @returns Whether an answer was claimed without durable entry evidence.
   */
  hasUnsettledClaim(decisionId: DecisionId): boolean {
    return this.claimedTurns.has(decisionId)
  }

  /** Durable entry evidence for one allocated answer request. */
  private onEntered(sessionId: SessionId, rpcId: SessionRequestId): void {
    const record = this.store()?.byRequestId(rpcId)
    if (record === undefined || record.answer === null) return
    if (record.sessionId !== sessionId) return
    this.pendingAnswers.delete(record.decisionId)
    this.claimedTurns.delete(record.decisionId)
    this.apply(record.decisionId, { entered: true })
  }

  /**
   * Claimed answers settle without entry evidence at their claimed turn's
   * end or the claimed turn's step end. Entered evidence wins: the sticky
   * `entered` fact outranks `turnEnded` inside the resolver.
   */
  private settleClaimed(sessionId: SessionId, turn: number): void {
    for (const [decisionId, claim] of this.claimedTurns) {
      if (claim.sessionId !== sessionId || claim.turn !== turn) continue
      this.claimedTurns.delete(decisionId)
      this.apply(decisionId, { turnEnded: true })
    }
  }

  /**
   * Agent disposal: in-flight reservations degrade, guards and caches drop.
   * Every drop binds to the exact incarnation: a late old-incarnation
   * disposal after a replacement was announced must not clear the
   * replacement's producing caches or degrade its live reservation.
   */
  private onDisposed(agent: Agent): void {
    const sessionId = agent.session.id
    const step = this.producingSteps.get(sessionId)
    if (step?.agent === agent) this.producingSteps.delete(sessionId)
    // Only the exact incarnation that armed it may clear the guard: a
    // replacement agent for the same session keeps its own guard.
    if (this.guards.get(sessionId)?.agent === agent) {
      this.guards.get(sessionId)?.disposer()
      this.guards.delete(sessionId)
    }
    // Reservation degradation answers to the session's current incarnation:
    // when a replacement is already announced, the disposed agent owns
    // nothing in flight anymore.
    if (this.currentAgents.get(sessionId) !== agent) return
    this.currentAgents.delete(sessionId)
    for (const record of this.store()?.list() ?? []) {
      if (record.sessionId !== sessionId) continue
      if (record.answer === null || record.answerIndex === 'admitted') continue
      if (record.answerIndex === 'dismissed' || record.answerIndex === 'withdrawn') continue
      this.pendingAnswers.delete(record.decisionId)
      this.apply(record.decisionId, { agentGone: true })
    }
  }

  /** Cold restore: pending inbox messages of a restored agent upgrade their reservation. */
  private inspectPending(agent: Agent): void {
    const store = this.store()
    if (store === undefined) return
    let messages: readonly UserMessage[]
    try {
      messages = [...agent.inbox.nextTurn, ...agent.inbox.nextStep]
    } catch (error: unknown) {
      this.ctx.logger.warn('session-decisions: inbox projection is not observable for %s: %s',
        agent.session.id, error instanceof Error ? error.message : String(error))
      return
    }
    for (const message of messages) {
      const rpcId = userRpcId(message)
      if (rpcId === undefined) continue
      const record = store.byRequestId(rpcId)
      if (record === undefined || record.answer === null) continue
      // Request-ID correlation is session-scoped: a pending answer message
      // derived from another session's request id never settles this question.
      if (record.sessionId !== agent.session.id) continue
      if (record.answerIndex !== 'submitting' && record.answerIndex !== 'needs_reconciliation') continue
      this.pendingAnswers.set(record.decisionId, {
        sessionId: agent.session.id,
        messageId: message.id,
        textDigest: digestOf({ text: messageText(message) }),
      })
      this.apply(record.decisionId, { pending: true })
    }
  }

  /** Reset the armed guard on the producing step's end or the turn's end. */
  private resetGuard(sessionId: SessionId, turn: number, step?: number): void {
    const guard = this.guards.get(sessionId)
    if (guard === undefined || guard.turn !== turn) return
    if (step !== undefined && guard.step !== step) return
    guard.disposer()
    this.guards.delete(sessionId)
  }

  /**
   * Correlate one inbox message to its reserved decision record, if any.
   * The request ID match is scoped to the message's own session: a request
   * ID derived for one session never correlates an insert in another.
   */
  private recordFor(message: UserMessage, sessionId: SessionId): ReservedDecisionRecord | undefined {
    const rpcId = userRpcId(message)
    if (rpcId === undefined) return undefined
    const record = this.store()?.byRequestId(rpcId)
    return hasReservedAnswer(record) && record.sessionId === sessionId ? record : undefined
  }

  /** Settle one fact batch through the service's single admission owner. */
  private apply(decisionId: DecisionId, facts: DecisionFacts): void {
    this.settle(decisionId, facts)
  }
}
