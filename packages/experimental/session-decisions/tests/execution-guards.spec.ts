/**
 * Producing-step guard through the current tool pipeline: a saved
 * `request_persistent_question` denies later native, PTC, and MCP bodies.
 * PTC identity is asserted from `tool/call` only. A nested question is the
 * pinned PTC refusal, not an observed producing step.
 * @module tests/execution-guards
 */

import { expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionInput, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import type { ProducingStepIdentity } from '../src/observers.ts'
import { PTC_REFUSAL_MESSAGE } from '../src/root-eligibility.ts'
import { stubAgent } from './agent-carrier.ts'
import {
  askUser,
  GUARD_SESSION,
  GUARD_TEXT,
  MCP_PING,
  openGuardWorld,
  PROBE,
  textChunks,
  toolCallChunks,
  type GuardWorld,
} from './execution-guards-fixture.ts'

const WAIT = { timeout: 8_000, interval: 20 } as const

async function finishPipeline(pipeline: ToolExecutionPipeline, input: ToolExecutionInput): Promise<ToolExecutionResult> {
  const prepared = await pipeline.prepare(input)
  if (prepared.kind === 'dispatch') return pipeline.complete(prepared.exec, await pipeline.dispatch(prepared.exec))
  if (prepared.kind === 'post-result') return pipeline.complete(prepared.exec, { kind: 'post-result', result: prepared.result })
  return prepared.result
}

/** Run one call through the native ToolExecutionPipeline. */
function runPipeline(world: GuardWorld, agent: Agent, name: string, args: unknown, callId: string): Promise<ToolExecutionResult> {
  const pipeline = new ToolExecutionPipeline(world.ctx.tools)
  return world.ctx.agents.withInitiator(agent, () => finishPipeline(pipeline, {
    signal: new AbortController().signal,
    callId: ToolCallId(callId),
    name,
    arguments: args,
    agent,
  }))
}

/** Save one question the way the loop logs a native tool call, then execute it. */
async function saveQuestion(world: GuardWorld, agent: Agent, callId: string, turn = 1, step = 1): Promise<ToolExecutionResult> {
  agent.session.append('turn/start', { turn })
  agent.session.append('step/start', { turn, step })
  agent.session.append('tool/call', {
    turn,
    step,
    callId: ToolCallId(callId),
    name: 'request_persistent_question',
    arguments: '{}',
  })
  return world.ctx.agents.withInitiator(agent, () => world.ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(callId),
    name: 'request_persistent_question',
    arguments: { question: 'Which database?', choices: ['Postgres', 'SQLite'] },
    agent,
  }))
}

function logged(world: GuardWorld, callId: string): { isError: boolean; text: string } {
  const found = world.log.toolResults.find(result => result.callId === callId)
  expect(found, callId).toBeDefined()
  if (found === undefined) throw new Error(`missing tool result ${callId}`)
  return found
}

it('leaves native, PTC, and MCP bodies runnable when the question write fails', async () => {
  const world = await openGuardWorld({
    realTurn: true,
    failWritesFrom: 1,
    script: [
      toolCallChunks([
        { id: 'call-q', name: 'request_persistent_question', args: { question: 'Which database?', choices: ['A', 'B'] } },
        { id: 'call-native', name: PROBE, args: {} },
        { id: 'call-mcp', name: MCP_PING, args: {} },
        { id: 'call-ptc', name: RUN_CODE_NAME, args: { description: 'Probe after a failed save', code: 'await tools.guard_probe({})' } },
      ]),
      textChunks('continued'),
    ],
  })
  world.runtime.behavior = async (spec) => {
    const probe = spec.bindings[0]?.functions[PROBE]
    if (probe === undefined) throw new Error('PTC bindings omitted guard_probe')
    await probe({})
    return { logs: [], value: 'program' }
  }
  expect(world.ctx.tools.get(MCP_PING)).toBeDefined()
  askUser(world.agent, 'ask me something')
  await vi.waitFor(() => {
    expect(world.log.toolResults.map(result => result.callId)).toEqual(['call-q', 'call-native', 'call-mcp', 'call-ptc'])
  }, WAIT)
  await vi.waitFor(() => { expect(world.agent.status).toBe('idle') }, WAIT)

  expect(logged(world, 'call-q').isError).toBe(true)
  expect(logged(world, 'call-q').text).not.toContain(GUARD_TEXT)
  expect(logged(world, 'call-native').isError).toBe(false)
  expect(logged(world, 'call-mcp').isError).toBe(false)
  expect(logged(world, 'call-mcp').text).toContain('pong')
  expect(logged(world, 'call-ptc').isError).toBe(false)
  expect(world.probeRuns.current).toBe(2)
  expect(world.runtime.runCount).toBe(1)
  expect(world.mcpCalls).toEqual(['ping'])
  expect(await world.service.catalog(GUARD_SESSION)).toEqual([])
}, 20_000)

it('denies native, PTC, and MCP bodies after a saved question, then runs the queued answer', async () => {
  const world = await openGuardWorld({
    realTurn: true,
    script: [
      toolCallChunks([
        { id: 'call-q', name: 'request_persistent_question', args: { question: 'Which database?', choices: ['A', 'B'] } },
        { id: 'call-native', name: PROBE, args: {} },
        { id: 'call-mcp', name: MCP_PING, args: {} },
        { id: 'call-ptc', name: RUN_CODE_NAME, args: { description: 'Probe while the guard is armed', code: 'await tools.guard_probe({})' } },
      ]),
      toolCallChunks([{ id: 'call-after', name: PROBE, args: {} }]),
      textChunks('done'),
    ],
  })
  world.runtime.behavior = async (spec) => {
    const probe = spec.bindings[0]?.functions[PROBE]
    if (probe === undefined) throw new Error('PTC bindings omitted guard_probe')
    await probe({})
    return { logs: [], value: 'program' }
  }
  expect(world.ctx.tools.get(MCP_PING)?.name).toBe(MCP_PING)
  askUser(world.agent, 'ask me something')
  await vi.waitFor(() => {
    expect(world.log.toolResults).toHaveLength(4)
  }, WAIT)
  await vi.waitFor(() => { expect(world.agent.status).toBe('idle') }, WAIT)

  const question = logged(world, 'call-q')
  expect(question.isError).toBe(false)
  expect(question.text).toContain('Answer to question')
  for (const callId of ['call-native', 'call-mcp', 'call-ptc']) {
    expect(world.log.toolCalls.some(call => call.callId === callId)).toBe(true)
    const sibling = logged(world, callId)
    expect(sibling.isError).toBe(true)
    expect(sibling.text).toContain(GUARD_TEXT)
  }
  expect(world.probeRuns.current).toBe(0)
  expect(world.runtime.runCount).toBe(0)
  expect(world.mcpCalls).toEqual([])
  expect(world.log.ptcStarts).toEqual([])
  const [saved] = await world.service.catalog(GUARD_SESSION)
  expect(saved).toMatchObject({ lifecycle: 'open', hasAnswer: false })
  if (saved === undefined) throw new Error('expected a saved question')

  const admitted = await world.service.admitAnswer(saved.decisionId, saved.revision, { choiceOrdinal: 1 })
  expect(admitted.outcome).toBe('accepted')
  await vi.waitFor(() => { expect(world.probeRuns.current).toBe(1) }, WAIT)
  await vi.waitFor(async () => {
    expect(await world.service.get(saved.decisionId)).toMatchObject({ answerIndex: 'admitted', lifecycle: 'answered' })
  }, WAIT)
  await vi.waitFor(() => { expect(world.agent.status).toBe('idle') }, WAIT)
  const after = logged(world, 'call-after')
  expect(after.isError).toBe(false)
  expect(world.runtime.runCount).toBe(0)
  expect(world.mcpCalls).toEqual([])
  expect(world.log.userTexts.some(text => text.startsWith(`Answer to question ${saved.decisionId}:`))).toBe(true)
}, 20_000)

it('refuses a nested PTC question and ignores tool/ptc-dispatch-start as producing identity', async () => {
  const seen: {
    message?: string
    outer: ProducingStepIdentity | undefined
    nested: ProducingStepIdentity | undefined
  } = { outer: undefined, nested: undefined }
  const world = await openGuardWorld({
    realTurn: true,
    script: [
      toolCallChunks([{
        id: 'call-run',
        name: RUN_CODE_NAME,
        args: { description: 'Ask from inside the program', code: 'await tools.request_persistent_question({})' },
      }]),
      toolCallChunks([{ id: 'call-after', name: PROBE, args: {} }]),
      textChunks('done'),
    ],
  })
  world.runtime.behavior = async (spec) => {
    const ask = spec.bindings[0]?.functions.request_persistent_question
    if (ask === undefined) throw new Error('PTC bindings omitted request_persistent_question')
    try {
      await ask({ question: 'Inside PTC?', choices: ['A', 'B'] })
    } catch (error) {
      seen.message = error instanceof Error ? error.message : String(error)
    }
    seen.outer = world.service.producingIdentity(world.agent.session.id, 'call-run')
    seen.nested = world.service.producingIdentity(world.agent.session.id, 'call-run:ptc:1')
    return { logs: [], value: 'finished' }
  }
  askUser(world.agent, 'ask from the program')
  await vi.waitFor(() => { expect(world.probeRuns.current).toBe(1) }, WAIT)
  await vi.waitFor(() => { expect(world.agent.status).toBe('idle') }, WAIT)

  expect(seen.message).toBe(PTC_REFUSAL_MESSAGE)
  expect(seen.outer).toMatchObject({ callId: 'call-run' })
  expect(seen.nested).toBeUndefined()
  expect(world.log.toolCalls.map(call => call.name)).toEqual([RUN_CODE_NAME, PROBE])
  expect(world.log.ptcStarts).toEqual([
    { sessionId: GUARD_SESSION, name: 'request_persistent_question', subCallId: 'call-run:ptc:1' },
  ])
  expect(world.log.ptcDispatches).toEqual([
    expect.objectContaining({
      name: 'request_persistent_question',
      subCallId: 'call-run:ptc:1',
      isError: true,
      errorCode: 'DECISION_PTC_UNSUPPORTED',
    }),
  ])
  expect(world.log.ptcDispatches[0]?.text).toContain(PTC_REFUSAL_MESSAGE)
  expect(logged(world, 'call-run').isError).toBe(false)
  expect(logged(world, 'call-after').isError).toBe(false)
  expect(await world.service.catalog(GUARD_SESSION)).toEqual([])
  expect(world.runtime.runCount).toBe(1)
}, 20_000)

it('does not treat a lone tool/ptc-dispatch-start as a producing tool call', async () => {
  const world = await openGuardWorld()
  const agent = stubAgent('ptc-start-only', world.ctx)
  await world.ctx.agents.register(agent.agent)
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append('step/start', { turn: 1, step: 1 })
  agent.session.append('tool/ptc-dispatch-start', {
    rootCallId: ToolCallId('outer'),
    parentCallId: ToolCallId('outer'),
    subCallId: ToolCallId('outer:ptc:1'),
    name: 'request_persistent_question',
    arguments: {},
  })
  expect(world.service.producingIdentity(agent.session.id, 'outer:ptc:1')).toBeUndefined()
  const refused = await world.ctx.agents.withInitiator(agent.agent, () => world.ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('outer:ptc:1'),
    name: 'request_persistent_question',
    arguments: { question: 'Which database?', choices: ['A', 'B'] },
    agent: agent.agent,
  }))
  expect(refused.isError).toBe(true)
  if (!refused.isError) throw new Error('expected the unobserved question to fail')
  expect(refused.error.info?.code).toBe('DECISION_CONFLICT')
  expect(refused.error.message).toContain('was not observed')
  expect(await world.service.catalog(agent.session.id)).toEqual([])
  expect(world.probeRuns.current).toBe(0)
}, 20_000)

it('resets the guard on step end and on turn end so native, PTC, and MCP bodies run', async () => {
  const world = await openGuardWorld()
  world.runtime.behavior = async (spec) => {
    const probe = spec.bindings[0]?.functions[PROBE]
    if (probe === undefined) throw new Error('PTC bindings omitted guard_probe')
    await probe({})
    return { logs: [], value: 'program' }
  }
  const stepAgent = stubAgent('guard-step-end', world.ctx)
  await world.ctx.agents.register(stepAgent.agent)
  const saved = await saveQuestion(world, stepAgent.agent, 'step-q')
  expect(saved.isError).toBe(false)

  const deniedNative = await runPipeline(world, stepAgent.agent, PROBE, {}, 'step-native')
  const deniedMcp = await runPipeline(world, stepAgent.agent, MCP_PING, {}, 'step-mcp')
  const deniedPtc = await runPipeline(world, stepAgent.agent, RUN_CODE_NAME, {
    description: 'Probe while the step guard is armed',
    code: 'await tools.guard_probe({})',
  }, 'step-ptc')
  expect(deniedNative.isError && deniedNative.error.message).toContain(GUARD_TEXT)
  expect(deniedMcp.isError && deniedMcp.error.message).toContain(GUARD_TEXT)
  expect(deniedPtc.isError && deniedPtc.error.message).toContain(GUARD_TEXT)
  expect(world.probeRuns.current).toBe(0)
  expect(world.runtime.runCount).toBe(0)
  expect(world.mcpCalls).toEqual([])

  stepAgent.session.append('step/end', { turn: 1, step: 1 })
  const native = await runPipeline(world, stepAgent.agent, PROBE, {}, 'step-native-later')
  const mcp = await runPipeline(world, stepAgent.agent, MCP_PING, {}, 'step-mcp-later')
  const ptc = await runPipeline(world, stepAgent.agent, RUN_CODE_NAME, {
    description: 'Probe after the step ends',
    code: 'await tools.guard_probe({})',
  }, 'step-ptc-later')
  expect(native.isError).toBe(false)
  expect(mcp.isError).toBe(false)
  if (!mcp.isError) expect(mcp.content[0]).toMatchObject({ type: 'text', text: 'pong' })
  expect(ptc.isError).toBe(false)
  expect(world.probeRuns.current).toBe(2)
  expect(world.runtime.runCount).toBe(1)
  expect(world.mcpCalls).toEqual(['ping'])

  const turnAgent = stubAgent('guard-turn-end', world.ctx)
  await world.ctx.agents.register(turnAgent.agent)
  const second = await saveQuestion(world, turnAgent.agent, 'turn-q')
  expect(second.isError).toBe(false)
  const denied = await runPipeline(world, turnAgent.agent, PROBE, {}, 'turn-native')
  expect(denied.isError && denied.error.message).toContain(GUARD_TEXT)
  expect(world.probeRuns.current).toBe(2)
  turnAgent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const later = await runPipeline(world, turnAgent.agent, PROBE, {}, 'turn-native-later')
  expect(later.isError).toBe(false)
  expect(world.probeRuns.current).toBe(3)
  expect(world.mcpCalls).toEqual(['ping'])
}, 20_000)
