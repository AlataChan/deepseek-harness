/**
 * The `./tools` consumer through the real ToolRuntime: registration,
 * producing-step identity, the pinned PTC refusal, root eligibility
 * refusals, argument bounds, guard arming with turn conclusion, and the
 * same-session read surface. Only external timing is stubbed; storage,
 * sessions, projections, the registry, and tool execution are real.
 * @module tests/tool
 */

import { expect, it, onTestFinished } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import service from '../src/service.ts'
import * as tools from '../src/tools.ts'
import { checkRootEligibility, PTC_REFUSAL_MESSAGE } from '../src/root-eligibility.ts'

import { stubAgent, stubAgentWith, type StubAgent } from './agent-carrier.ts'

const testToolSignal = new AbortController().signal

async function harness(withService = true): Promise<{ ctx: Context }> {
  const root = await mkdtemp(join(tmpdir(), 'session-decisions-tools-'))
  const ctx = new Context()
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  // The question path never prompts; the controller stub exists for the
  // service's required-service check only.
  ctx.provide('sessionController', { prompt: async () => {
    throw new Error('tool tests never prompt')
  } } as never)
  if (withService) await ctx.plugin(service)
  await ctx.plugin(tools, {})
  return { ctx }
}

/** Observe one producing step for `callId` exactly as the real loop appends it. */
function openProducingStep(stub: StubAgent, callId: ToolCallId, turn = 1, step = 1): void {
  stub.session.append('turn/start', { turn })
  stub.session.append('step/start', { turn, step })
  stub.session.append('tool/call', { turn, step, callId, name: 'request_persistent_question', arguments: '{}' })
}

/** Observe the end of one producing step. */
function closeStep(stub: StubAgent, turn = 1, step = 1): void {
  stub.session.append('step/end', { turn, step })
}

/** Execute one registered tool call for `agent` under a live initiator. */
async function execute(
  ctx: Context,
  agent: Agent,
  name: string,
  args: unknown,
  callId: ToolCallId = ToolCallId(`call-${Math.random()}`),
  parent?: unknown,
): Promise<ToolExecutionResult> {
  return ctx.agents.withInitiator(agent, () => ctx.tools.execute({
    signal: testToolSignal,
    callId,
    name,
    arguments: args,
    agent,
    ...(parent === undefined ? {} : { parent: parent as never }),
  }))
}

/** Assert a failure result and return its error. */
function failure(result: ToolExecutionResult): { message: string; code: string | undefined } {
  expect(result.isError).toBe(true)
  if (!result.isError) throw new Error('expected a failure result')
  return { message: result.error.message, code: result.error.info?.code }
}

/** Open the next producing step for an arbitrary tool call. */
function openNextStep(stub: StubAgent, callId: ToolCallId): void {
  const step = stub.session.snapshotEvents()
    .filter(event => event.type === 'step/start')
    .length + 1
  stub.session.append('step/start', { turn: 1, step })
  stub.session.append('tool/call', { turn: 1, step, callId, name: 'request_persistent_question', arguments: '{}' })
}

it('registers both tools under the function-plugin contract', async () => {
  const { ctx } = await harness()
  expect(tools.name).toBe('session-decisions-tools')
  expect(tools.inject).toEqual(['tools'])
  expect(ctx.tools.get('request_persistent_question')).toBeDefined()
  expect(ctx.tools.get('read_persistent_question')).toBeDefined()
})

it('saves durably, arms the guard, persists card meta, and concludes the turn', async () => {
  const { ctx } = await harness()
  const stub = stubAgent('q-root', ctx)
  await ctx.agents.register(stub.agent)
  const callId = ToolCallId('call-q1')
  openProducingStep(stub, callId)

  const result = await execute(ctx, stub.agent, 'request_persistent_question', {
    question: 'Which database?',
    choices: ['Postgres', 'SQLite'],
  }, callId)

  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected success')
  expect(result.concludesTurn).toBe(true)
  expect(result.value).toMatchObject({ revision: 0, choices: ['Postgres', 'SQLite'] })
  const decisionId = (result.value as { decisionId: string }).decisionId
  // The result text states the answer-format contract and both identifiers.
  const text = result.content[0]
  expect(text?.type).toBe('text')
  if (text?.type !== 'text') throw new Error('expected a text block')
  expect(text.text).toContain(`Answer to question ${decisionId}:`)
  expect(text.text).toContain('read_persistent_question')
  expect(text.text).toContain('1. Postgres')

  // The card metadata persists exactly the decision identity pair.
  expect(result.meta).toEqual({ decisionId, revision: 0 })

  // The record is durably open and unanswered.
  const view = await ctx.sessionDecisions.get(decisionId as never)
  expect(view).toMatchObject({ sessionId: stub.session.id, question: 'Which database?', lifecycle: 'open', hasAnswer: false })

  // The guard denies the next tool call of the same step...
  const denied = await execute(ctx, stub.agent, 'read_persistent_question', { decisionId })
  expect(failure(denied).message).toContain('A persistent question was just asked')
})

it('refuses a single-choice question before saving', async () => {
  const { ctx } = await harness()
  const stub = stubAgent('q-single', ctx)
  await ctx.agents.register(stub.agent)
  const callId = ToolCallId('call-q1')
  openProducingStep(stub, callId)

  const result = await execute(ctx, stub.agent, 'request_persistent_question', {
    question: 'Proceed?',
    choices: ['Yes'],
  }, callId)

  expect(failure(result)).toMatchObject({ code: 'DECISION_INVALID' })
  // Nothing reached the store: the refusal happened before any save.
  expect(await ctx.sessionDecisions.catalog(stub.session.id as never)).toEqual([])
})

it('retries a guard-denied call after the producing step ends', async () => {
  const { ctx } = await harness()
  const stub = stubAgent('q-reset', ctx)
  await ctx.agents.register(stub.agent)
  const callId = ToolCallId('call-q1')
  openProducingStep(stub, callId)
  const asked = await execute(ctx, stub.agent, 'request_persistent_question', {
    question: 'Deploy now?',
    choices: ['Yes', 'No'],
  }, callId)
  expect(asked.isError).toBe(false)
  const decisionId = (asked.isError ? {} : asked.value as { decisionId: string }).decisionId

  closeStep(stub)
  const read = await execute(ctx, stub.agent, 'read_persistent_question', { decisionId })
  expect(read.isError).toBe(false)
  // The wire request ID stays Host-side (DecisionView only); the model never
  // sees the correlation identity in tool output.
  expect(read.value).not.toHaveProperty('requestId')
})

it('resets the guard at turn end without a step/end', async () => {
  const { ctx } = await harness()
  const stub = stubAgent('q-turn', ctx)
  await ctx.agents.register(stub.agent)
  const callId = ToolCallId('call-q1')
  openProducingStep(stub, callId)
  const asked = await execute(ctx, stub.agent, 'request_persistent_question', {
    question: 'Ship it?',
    choices: ['Ship', 'Hold'],
  }, callId)
  expect(asked.isError).toBe(false)
  const decisionId = (asked.isError ? {} : asked.value as { decisionId: string }).decisionId

  stub.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const read = await execute(ctx, stub.agent, 'read_persistent_question', { decisionId })
  expect(read.isError).toBe(false)
})

it('refuses a nested PTC question with the pinned literal before saving anything', async () => {
  const { ctx } = await harness()
  const stub = stubAgent('q-ptc', ctx)
  await ctx.agents.register(stub.agent)
  const callId = ToolCallId('call-ptc')
  openProducingStep(stub, callId)

  const result = await execute(ctx, stub.agent, 'request_persistent_question', {
    question: 'Inside PTC?',
    choices: ['A', 'B'],
  }, callId, Symbol('ptc-program'))

  expect(failure(result)).toEqual({ message: PTC_REFUSAL_MESSAGE, code: 'DECISION_PTC_UNSUPPORTED' })
  // Nothing was saved and no guard was armed: the next call is an ordinary
  // logged refusal, not a guard denial.
  const followup = await execute(ctx, stub.agent, 'read_persistent_question', { decisionId: 'decision-00000000' })
  expect(failure(followup).code).toBe('DECISION_NOT_FOUND')
})

it('refuses while owned background jobs run, and allows them after completion', async () => {
  const { ctx } = await harness()
  const stub = stubAgent('q-jobs', ctx)
  await ctx.agents.register(stub.agent)
  const job = { id: 'job-1', kind: 'followup', label: 'work', owner: stub.session.id, status: 'running' }
  ctx.provide('jobs', { list: () => [job] } as never)
  const callId = ToolCallId('call-jobs')
  openProducingStep(stub, callId)

  const busy = await execute(ctx, stub.agent, 'request_persistent_question', {
    question: 'While a job runs?',
    choices: ['A', 'B'],
  }, callId)
  expect(failure(busy).code).toBe('DECISION_BUSY_OWNED_WORK')
  expect(failure(busy).message).toContain('Ask the user in ordinary chat instead')

  job.status = 'completed'
  const callId2 = ToolCallId('call-jobs-2')
  openNextStep(stub, callId2)
  const ok = await execute(ctx, stub.agent, 'request_persistent_question', {
    question: 'After the job?',
    choices: ['A', 'B'],
  }, callId2)
  expect(ok.isError).toBe(false)
})

it('refuses a running delegated subagent child', async () => {
  const { ctx } = await harness()
  const stub = stubAgent('q-sub', ctx)
  await ctx.agents.register(stub.agent)
  const child = stubAgent('q-sub-child', ctx)
  await ctx.agents.register(child.agent)
  ctx.provide('subagents', { listChildren: async () => [{ id: child.agent.id }] } as never)
  const callId = ToolCallId('call-sub')
  openProducingStep(stub, callId)

  const busy = await execute(ctx, stub.agent, 'request_persistent_question', {
    question: 'While a subagent runs?',
    choices: ['A', 'B'],
  }, callId)
  expect(failure(busy).code).toBe('DECISION_BUSY_OWNED_WORK')
})

it('refuses a Team teammate but allows the Lead', async () => {
  const { ctx } = await harness()
  const teammate = stubAgent('q-team-mate', ctx)
  await ctx.agents.register(teammate.agent)
  const membership = { root: teammate.session.id, id: 'team', role: 'teammate' as 'teammate' | 'lead', name: 'worker' }
  ctx.provide('agentTeams', {
    tryMembership: () => membership,
    listMembers: () => [{ id: teammate.session.id, name: membership.name, role: membership.role, status: 'inactive', diagnostics: [] }],
  } as never)
  const callId = ToolCallId('call-team')
  openProducingStep(teammate, callId)

  const busy = await execute(ctx, teammate.agent, 'request_persistent_question', {
    question: 'As a teammate?',
    choices: ['A', 'B'],
  }, callId)
  expect(failure(busy).code).toBe('DECISION_BUSY_OWNED_WORK')

  // A lead-role membership does not block.
  membership.role = 'lead'
  const callId2 = ToolCallId('call-team-2')
  openNextStep(teammate, callId2)
  const ok = await execute(ctx, teammate.agent, 'request_persistent_question', {
    question: 'As the lead?',
    choices: ['A', 'B'],
  }, callId2)
  expect(ok.isError).toBe(false)
})

it('refuses a Lead while a teammate is provisioning or running', async () => {
  const { ctx } = await harness()
  const lead = stubAgent('q-team-lead', ctx)
  await ctx.agents.register(lead.agent)
  const member = { id: SessionId('q-team-worker'), name: 'worker', role: 'teammate' as const, status: 'provisioning' as 'running' | 'provisioning' | 'inactive', diagnostics: [] }
  ctx.provide('agentTeams', {
    tryMembership: () => ({ root: lead.session.id, id: 'team', role: 'lead' as const, name: 'lead' }),
    listMembers: () => [member],
  } as never)
  const callId = ToolCallId('call-provisioning')
  openProducingStep(lead, callId)
  const busy = await execute(ctx, lead.agent, 'request_persistent_question', {
    question: 'While provisioning?',
    choices: ['A', 'B'],
  }, callId)
  expect(failure(busy).code).toBe('DECISION_BUSY_OWNED_WORK')

  // An inactive teammate is history, not owned work: the Lead may ask.
  member.status = 'inactive'
  const callId2 = ToolCallId('call-inactive')
  openNextStep(lead, callId2)
  const ok = await execute(ctx, lead.agent, 'request_persistent_question', {
    question: 'After settle?',
    choices: ['A', 'B'],
  }, callId2)
  expect(ok.isError).toBe(false)
})

it('refuses a subagent-origin session', async () => {
  const { ctx } = await harness()
  const session = ctx.sessions.create(SessionId('q-origin'), { meta: { origin: 'subagent' } })
  const stub = stubAgentWith(session, ctx)
  await ctx.agents.register(stub.agent)
  const callId = ToolCallId('call-origin')
  openProducingStep(stub, callId)

  const busy = await execute(ctx, stub.agent, 'request_persistent_question', {
    question: 'From a subagent?',
    choices: ['A', 'B'],
  }, callId)
  expect(failure(busy).code).toBe('DECISION_BUSY_OWNED_WORK')
})

it('refuses without writing when the producing step was not observed', async () => {
  const { ctx } = await harness()
  const stub = stubAgent('q-noid', ctx)
  await ctx.agents.register(stub.agent)

  const result = await execute(ctx, stub.agent, 'request_persistent_question', {
    question: 'No step?',
    choices: ['A', 'B'],
  })
  expect(failure(result).code).toBe('DECISION_CONFLICT')
})

it('enforces argument bounds before saving', async () => {
  const { ctx } = await harness()
  const stub = stubAgent('q-bounds', ctx)
  await ctx.agents.register(stub.agent)

  const ask = async (args: unknown): Promise<{ message: string; code: string | undefined }> => {
    const callId = ToolCallId(`call-${Math.random()}`)
    openNextStep(stub, callId)
    return failure(await execute(ctx, stub.agent, 'request_persistent_question', args, callId))
  }

  expect((await ask({ question: '   ' })).code).toBe('DECISION_INVALID')
  expect((await ask({ question: 'Too many?', choices: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] })).code)
    .toBe('DECISION_LIMIT_EXCEEDED')
  expect((await ask({ question: 'Empty label?', choices: ['ok', ''] })).code).toBe('DECISION_INVALID')
  expect((await ask({ question: 'Bad ttl?', choices: ['A'], ttlMs: 0 })).code).toBe('DECISION_INVALID')
  expect((await ask({ question: 'Long ttl?', choices: ['A'], ttlMs: 25 * 60 * 60 * 1000 })).code)
    .toBe('DECISION_INVALID')
  expect((await ask({ question: 'x'.repeat(17 * 1024) })).code).toBe('DECISION_LIMIT_EXCEEDED')
})

it('reads a saved question only within its own session', async () => {
  const { ctx } = await harness()
  const owner = stubAgent('q-owner', ctx)
  await ctx.agents.register(owner.agent)
  const foreign = stubAgent('q-foreign', ctx)
  await ctx.agents.register(foreign.agent)
  const callId = ToolCallId('call-read')
  openProducingStep(owner, callId)
  const asked = await execute(ctx, owner.agent, 'request_persistent_question', {
    question: 'Readable?',
    choices: ['Yes', 'No'],
  }, callId)
  expect(asked.isError).toBe(false)
  const decisionId = (asked.isError ? {} : asked.value as { decisionId: string }).decisionId
  // The producing step closes with the concluded turn's step; the read is an
  // ordinary tool call after that boundary.
  closeStep(owner)

  // Same session: an ordinary logged success carrying the full view.
  const own = await execute(ctx, owner.agent, 'read_persistent_question', { decisionId })
  expect(own.isError).toBe(false)
  if (!own.isError) {
    expect(own.value).toMatchObject({
      decisionId, sessionId: owner.session.id, question: 'Readable?', lifecycle: 'open', hasAnswer: false,
    })
    expect(own.meta).toEqual({ decisionId, revision: 0 })
  }

  // Foreign session: the same ordinary logged refusal, never the record.
  const other = await execute(ctx, foreign.agent, 'read_persistent_question', { decisionId })
  expect(failure(other)).toEqual({
    message: 'No question with this ID exists in this conversation',
    code: 'DECISION_NOT_FOUND',
  })

  // Unknown ID: identical refusal shape.
  const unknown = await execute(ctx, owner.agent, 'read_persistent_question', { decisionId: 'decision-00000000' })
  expect(failure(unknown).code).toBe('DECISION_NOT_FOUND')
})

it('keeps the model-facing answer-format text stable', async () => {
  const { ctx } = await harness()
  const stub = stubAgent('q-text', ctx)
  await ctx.agents.register(stub.agent)
  const callId = ToolCallId('call-text')
  openProducingStep(stub, callId)
  const result = await execute(ctx, stub.agent, 'request_persistent_question', {
    question: 'Free text?',
  }, callId)
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected success')
  const block = result.content[0]
  if (block?.type !== 'text') throw new Error('expected a text block')
  expect(block.text).toContain('The user will answer with free text.')
  expect(block.text).toContain('The turn has ended')
})


it('presents both pending tools through their registered Host presenters', async () => {
  const { ctx } = await harness()
  expect(ctx.tools.get('request_persistent_question')?.presentCall?.({ question: 'Which database?' }))
    .toMatchObject({ card: 'generic', title: 'Ask the user a persistent question', rawInput: 'Which database?' })
  expect(ctx.tools.get('read_persistent_question')?.presentCall?.({ decisionId: 'saved-question' }))
    .toMatchObject({ card: 'generic', title: 'Read a persistent question', rawInput: 'saved-question' })
})

it('refuses creation without a calling Agent', async () => {
  const { ctx } = await harness()
  const result = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('no-agent'),
    name: 'request_persistent_question', arguments: { question: 'Which database?' } })
  expect(failure(result).code).toBe('DECISION_INVALID')
})

it('refuses a tool mounted without the question service', async () => {
  const { ctx } = await harness(false)
  const stub = stubAgent('service-unavailable', ctx)
  await ctx.agents.register(stub.agent)
  expect(failure(await execute(ctx, stub.agent, 'request_persistent_question', { question: 'Which database?' })).code)
    .toBe('DECISION_UNAVAILABLE')
})

it.each([
  { choices: ['', 'valid'] }, { ttlMs: 0 }, { ttlMs: 0.5 },
])('refuses malformed model arguments before saving: %j', async (args) => {
  const { ctx } = await harness()
  const stub = stubAgent('invalid-arguments', ctx)
  await ctx.agents.register(stub.agent)
  const id = ToolCallId('invalid-question')
  openProducingStep(stub, id)
  expect(failure(await execute(ctx, stub.agent, 'request_persistent_question', { question: 'Which database?', ...args }, id)).code)
    .toBe('DECISION_INVALID')
  expect(await ctx.sessionDecisions.catalog(stub.session.id)).toEqual([])
})

it.each([new Error('goal storage unavailable'), 'goal backend disconnected'])('keeps a saved question usable when Goal disarm fails: %s', async (error) => {
  const { ctx } = await harness()
  const stub = stubAgent('goal-disarm-error', ctx)
  await ctx.agents.register(stub.agent)
  ctx.provide('goals', { get: () => undefined, disarm() { throw error } } as never)
  const id = ToolCallId('disarm-question')
  openProducingStep(stub, id)
  expect((await execute(ctx, stub.agent, 'request_persistent_question', { question: 'Which database?' }, id)).isError).toBe(false)
  expect(await ctx.sessionDecisions.catalog(stub.session.id)).toHaveLength(1)
})

it('reads the closure and dismissal metadata retained for a settled question', async () => {
  const { ctx } = await harness()
  const stub = stubAgent('read-dismissed', ctx)
  await ctx.agents.register(stub.agent)
  const saved = await ctx.sessionDecisions.create({ sessionId: stub.session.id, question: 'Which database?', choices: [] })
  await ctx.sessionDecisions.admitAnswer(saved.decisionId, saved.revision, { text: 'SQLite' }, async () => { throw new Error('hold admission') })
  const current = await ctx.sessionDecisions.get(saved.decisionId)
  await ctx.sessionDecisions.dismiss(saved.decisionId, current!.revision)
  const result = await execute(ctx, stub.agent, 'read_persistent_question', { decisionId: saved.decisionId })
  expect(result.isError).toBe(false)
  if (!result.isError) {
    expect(result.value).toMatchObject({ resolutionKind: 'dismissed' })
    expect(result.value).toHaveProperty('closedAtUtc')
  }
})

it('handles registry loss while the optional child catalog is still being read', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const registry = ctx.plugin(AgentRegistry)
  await registry
  const stub = stubAgent('eligibility-dependency-loss', ctx)
  await ctx.agents.register(stub.agent)
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<{ id: SessionId }[]>()
  ctx.provide('subagents', { listChildren: () => { entered.resolve(undefined); return release.promise } } as never)
  try {
    const checking = checkRootEligibility(ctx, stub.agent)
    await entered.promise
    await registry.dispose()
    release.resolve([{ id: SessionId('missing-child') }])
    expect(await checking).toEqual({ ok: true })
  } finally { release.resolve([]); await ctx.fiber.dispose() }
})


it('refuses an overlong choice label before saving', async () => {
  const { ctx } = await harness()
  const stub = stubAgent('long-choice', ctx)
  await ctx.agents.register(stub.agent)
  const id = ToolCallId('long-choice-question')
  openProducingStep(stub, id)
  expect(failure(await execute(ctx, stub.agent, 'request_persistent_question', {
    question: 'Which database?', choices: ['x'.repeat(513), 'valid'],
  }, id)).code).toBe('DECISION_LIMIT_EXCEEDED')
  expect(await ctx.sessionDecisions.catalog(stub.session.id)).toEqual([])
})

it('saves the model-requested expiry when it fits the configured lifetime', async () => {
  const { ctx } = await harness()
  const stub = stubAgent('short-question', ctx)
  await ctx.agents.register(stub.agent)
  const id = ToolCallId('short-question-call')
  openProducingStep(stub, id)
  expect((await execute(ctx, stub.agent, 'request_persistent_question', { question: 'Which database?', ttlMs: 1000 }, id)).isError)
    .toBe(false)
  const [view] = await ctx.sessionDecisions.catalog(stub.session.id)
  expect(Date.parse(view!.expiresAtUtc) - Date.parse(view!.createdAtUtc)).toBe(1000)
})


it('releases the producing guard when a different authenticated human message is claimed', async () => {
  const { ctx } = await harness()
  const stub = stubAgent('human-claim-guard', ctx)
  await ctx.agents.register(stub.agent)
  const id = ToolCallId('human-claim-question')
  openProducingStep(stub, id)
  const asked = await execute(ctx, stub.agent, 'request_persistent_question', { question: 'Which database?' }, id)
  expect(asked.isError).toBe(false)
  if (asked.isError) throw new Error('question failed')
  const value = asked.value as { decisionId: string }
  const human = createUserMessage({ content: [{ type: 'text', text: 'I changed the request.' }], source: { kind: 'user' } })
  ctx.emit('agent/inbox/claimed', { agent: stub.agent, message: human, turn: 1 })
  expect((await execute(ctx, stub.agent, 'read_persistent_question', { decisionId: value.decisionId })).isError).toBe(false)
})
