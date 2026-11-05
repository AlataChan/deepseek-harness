/** Real Node child, tool registry, AgentLoop, and loopback MCP guard integration. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import FileSystem from '@deepseek-ai/dsh-fs-local'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import Sandbox from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import NodePtcRuntime from '@deepseek-ai/dsh-ptc-runtime-node'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { RUN_CODE_NAME, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import { stubAgent } from './agent-carrier.ts'
import { PTC_REFUSAL_MESSAGE } from '../src/root-eligibility.ts'
import { askUser, GUARD_SESSION, GUARD_TEXT, MCP_PING, openGuardWorld, PROBE, textChunks, toolCallChunks } from './execution-guards-fixture.ts'

const WAIT = { timeout: 15_000, interval: 20 } as const

async function mountRuntime(ctx: Context, cwd: string): Promise<NodePtcRuntime> {
  await ctx.plugin(FileSystem)
  await ctx.plugin(Subprocess)
  await ctx.plugin(Sandbox, {})
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: cwd })
  await ctx.plugin(NodePtcRuntime, { executionMode: 'per-call' })
  return ctx.ptcRuntime as NodePtcRuntime
}

function program(marker: string): string {
  return `
    const fs = await import('node:fs/promises');
    await fs.writeFile(${JSON.stringify(marker)}, String(process.pid));
    console.log('real-node', process.pid, process.cwd());
    const probe = await tools.${PROBE}({});
    const ping = await tools.${MCP_PING}({});
    return { probe, ping, pid: process.pid, cwd: process.cwd() };
  `
}

it('executes real Node tool bindings before save and after an authenticated queued answer, denying saved-step siblings before bodies', async () => {
  const world = await openGuardWorld({
    mountRuntime,
    realTurn: true,
    script: [
      toolCallChunks([{ id: 'before', name: RUN_CODE_NAME, args: { description: 'Before question', code: program('before.txt') } }]),
      toolCallChunks([
        { id: 'question', name: 'request_persistent_question', args: { question: 'Which database?', choices: ['A', 'B'] } },
        { id: 'denied-native', name: PROBE, args: {} },
        { id: 'denied-mcp', name: MCP_PING, args: {} },
        { id: 'denied-node', name: RUN_CODE_NAME, args: { description: 'Denied program', code: program('denied.txt') } },
      ]),
      toolCallChunks([{ id: 'after', name: RUN_CODE_NAME, args: { description: 'After answer', code: program('after.txt') } }]),
      textChunks('done'),
    ],
  })
  const run = vi.spyOn(world.runtime, 'run')
  const spawn = vi.spyOn(world.ctx.subprocess, 'spawn')
  askUser(world.agent, 'Ask a question after probing')
  await vi.waitFor(() => { expect(world.log.toolResults).toHaveLength(5) }, WAIT)
  await vi.waitFor(() => { expect(world.agent.status).toBe('idle') }, WAIT)
  const cwd = world.agent.session.header.cwd
  if (cwd === undefined) throw new Error('missing temporary cwd')
  const firstPid = Number(await readFile(join(cwd, 'before.txt'), 'utf8'))
  expect(firstPid).toBeGreaterThan(0)
  expect(firstPid).not.toBe(process.pid)
  expect(world.log.toolResults.find(row => row.callId === 'before')?.isError).toBe(false)
  expect(world.log.toolResults.find(row => row.callId === 'before')?.text).toContain('pong')
  expect(world.log.toolResults.find(row => row.callId === 'question')).toMatchObject({ isError: false })
  for (const callId of ['denied-native', 'denied-mcp', 'denied-node']) {
    expect(world.log.toolResults.find(row => row.callId === callId)?.isError).toBe(true)
    expect(world.log.toolResults.find(row => row.callId === callId)?.text).toContain(GUARD_TEXT)
  }
  expect(run).toHaveBeenCalledTimes(1)
  expect(spawn).toHaveBeenCalledTimes(1)
  expect(world.probeRuns.current).toBe(1)
  expect(world.mcpCalls).toEqual(['ping'])
  await expect(readFile(join(cwd, 'denied.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  const [saved] = await world.service.catalog(GUARD_SESSION)
  if (saved === undefined) throw new Error('missing saved question')
  expect(saved).toMatchObject({ lifecycle: 'open', hasAnswer: false })
  expect(await world.service.admitAnswer(saved.decisionId, saved.revision, { choiceOrdinal: 1 })).toMatchObject({ outcome: 'accepted' })
  await vi.waitFor(() => {
    expect(world.log.toolResults.find(row => row.callId === 'after')?.isError).toBe(false)
    expect(world.log.toolResults.find(row => row.callId === 'after')?.text).toContain('pong')
  }, WAIT)
  await vi.waitFor(() => { expect(world.agent.status).toBe('idle') }, WAIT)
  expect(await world.service.get(saved.decisionId)).toMatchObject({ lifecycle: 'answered', answerIndex: 'admitted' })
  expect(world.log.userTexts.some(text => text.startsWith(`Answer to question ${saved.decisionId}:`))).toBe(true)
  const secondPid = Number(await readFile(join(cwd, 'after.txt'), 'utf8'))
  expect(secondPid).toBeGreaterThan(0)
  expect(secondPid).not.toBe(process.pid)
  expect(secondPid).not.toBe(firstPid)
  expect(run).toHaveBeenCalledTimes(2)
  expect(spawn).toHaveBeenCalledTimes(2)
  expect(world.probeRuns.current).toBe(2)
  expect(world.mcpCalls).toEqual(['ping', 'ping'])
  expect(world.log.ptcDispatches.map(row => [row.name, row.isError])).toEqual([
    [PROBE, false], [MCP_PING, false], [PROBE, false], [MCP_PING, false],
  ])
  const exits = []
  for (const result of spawn.mock.results) {
    if (result.type !== 'return') throw new Error('spawn failed')
    // Per-call workers terminate after returning their RPC completion.
    exits.push(await result.value.done)
    await result.value.waitForExit()
  }
  process.stdout.write(`real Node guard evidence ${JSON.stringify({ hostPid: process.pid, firstPid, secondPid, cwd, exits, mcpCalls: world.mcpCalls })}\n`)
}, 30_000)

it('clears native, MCP, and real Node admission on step end and turn end', async () => {
  const world = await openGuardWorld({ mountRuntime })
  const pipeline = new ToolExecutionPipeline(world.ctx.tools)
  async function execute(agent: typeof world.agent, name: string, args: object, callId: string) {
    const input: ToolExecutionInput = { signal: new AbortController().signal, callId: ToolCallId(callId), name, arguments: args, agent }
    return world.ctx.agents.withInitiator(agent, async () => {
      const prepared = await pipeline.prepare(input)
      if (prepared.kind === 'dispatch') return pipeline.complete(prepared.exec, await pipeline.dispatch(prepared.exec))
      if (prepared.kind === 'post-result') return pipeline.complete(prepared.exec, { kind: 'post-result', result: prepared.result })
      return prepared.result
    })
  }
  const spawn = vi.spyOn(world.ctx.subprocess, 'spawn')
  for (const ending of ['step', 'turn'] as const) {
    const { agent } = stubAgent(`real-node-${ending}`, world.ctx)
    await world.ctx.agents.register(agent)
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId(`${ending}-q`), name: 'request_persistent_question', arguments: '{}' })
    expect((await execute(agent, 'request_persistent_question', { question: `${ending}?`, choices: ['A', 'B'] }, `${ending}-q`)).isError).toBe(false)
    const calls = [
      { name: PROBE, args: {} },
      { name: MCP_PING, args: {} },
      { name: RUN_CODE_NAME, args: { description: 'Boundary probe', code: program(`${ending}.txt`) } },
    ]
    const count = spawn.mock.calls.length
    for (const call of calls) {
      const result = await execute(agent, call.name, call.args, `${ending}-denied-${call.name}`)
      expect(result.isError && result.error.message).toContain(GUARD_TEXT)
    }
    expect(spawn).toHaveBeenCalledTimes(count)
    if (ending === 'step') {
      agent.session.append('step/end', { turn: 1, step: 1 })
      agent.session.append('step/start', { turn: 1, step: 2 })
    } else {
      agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      agent.session.append('turn/start', { turn: 2 })
      agent.session.append('step/start', { turn: 2, step: 1 })
    }
    for (const call of calls) expect((await execute(agent, call.name, call.args, `${ending}-allowed-${call.name}`)).isError).toBe(false)
    expect(spawn).toHaveBeenCalledTimes(count + 1)
  }
  expect(world.probeRuns.current).toBe(4)
  expect(world.mcpCalls).toEqual(['ping', 'ping', 'ping', 'ping'])
}, 30_000)

it('refuses a nested question in a real Node child without saving a decision', async () => {
  const world = await openGuardWorld({
    mountRuntime,
    realTurn: true,
    script: [
      toolCallChunks([{ id: 'nested', name: RUN_CODE_NAME, args: {
        description: 'Nested question refusal',
        code: `let message; try { await tools.request_persistent_question({ question: 'Nested?', choices: ['A', 'B'] }) } catch (error) { message = error.message }; console.log(message); ${program('nested.txt')}`,
      } }]),
      textChunks('done'),
    ],
  })
  const spawn = vi.spyOn(world.ctx.subprocess, 'spawn')
  askUser(world.agent, 'Try a nested question')
  await vi.waitFor(() => { expect(world.log.toolResults).toHaveLength(1) }, WAIT)
  await vi.waitFor(() => { expect(world.agent.status).toBe('idle') }, WAIT)
  expect(world.log.toolResults[0]?.isError).toBe(false)
  expect(world.log.toolResults[0]?.text).toContain(PTC_REFUSAL_MESSAGE)
  expect(world.log.ptcDispatches[0]).toMatchObject({
    name: 'request_persistent_question', isError: true, errorCode: 'DECISION_PTC_UNSUPPORTED',
  })
  expect(world.log.ptcDispatches[0]?.text).toContain(PTC_REFUSAL_MESSAGE)
  expect(world.service.producingIdentity(GUARD_SESSION, 'nested:ptc:1')).toBeUndefined()
  expect(await world.service.catalog(GUARD_SESSION)).toEqual([])
  expect(world.probeRuns.current).toBe(1)
  expect(world.mcpCalls).toEqual(['ping'])
  expect(spawn).toHaveBeenCalledTimes(1)
}, 30_000)
