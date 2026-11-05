/**
 * Real-loop world for producing-step guard tests: scripted model, selectable
 * PTC runtime (scripted by default), and a local MCP server through mcp-client.
 * @module tests/execution-guards-fixture
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ApiSessionAgentController } from '@deepseek-ai/dsh-api-session-controller/src/agent.ts'
import { SessionCommandController } from '@deepseek-ai/dsh-api-session-controller/src/commands.ts'
import type { SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller'
import type { AdmittedPromptContentPart, AttachmentAdmissionPart } from '@deepseek-ai/dsh-attachment'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { apply } from '@deepseek-ai/dsh-mcp-client'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import type { KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { defineTool } from '@deepseek-ai/dsh-tools'
import PtcRuntime from '@deepseek-ai/dsh-ptc-runtime'
import type { PtcRunRequest, PtcRunResult, PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import { toNodeHandler, type NodeIncomingMessageLike } from '@modelcontextprotocol/node'
import { createMcpHandler, McpServer, type CallToolResult } from '@modelcontextprotocol/server'
import { onTestFinished } from 'vitest'
import { z } from 'zod'
import SessionDecisionsService from '../src/index.ts'
import type { SessionDecisionsConfig } from '../src/index.ts'
import { decisionsDomain } from '../src/schema.ts'
import * as tools from '../src/tools.ts'

/** Session driven by the scripted loop. */
export const GUARD_SESSION = SessionId('execution-guards')

/** Native tool whose body records that it ran. */
export const PROBE = 'guard_probe'

/** Public name mcp-client assigns to the fixture's `ping` tool. */
export const MCP_PING = 'mcp__guardfix__ping'

/** Model-facing denial pinned by the armed question guard. */
export const GUARD_TEXT =
  'A persistent question was just asked; the turn ends here so the user can answer. Do not call further tools until the answer arrives.'

/** One loopback MCP server and the tool bodies it actually ran. */
interface LocalMcpFixture {
  readonly url: string
  readonly calls: string[]
  close(): Promise<void>
}

/**
 * Start a stateless Streamable HTTP MCP server on `127.0.0.1` port 0.
 * `ping` records the call and replies `pong`. Close waits for the handler and the socket.
 */
async function startLocalMcpFixture(): Promise<LocalMcpFixture> {
  const calls: string[] = []
  const handler = createMcpHandler(() => {
    const mcp = new McpServer(
      { name: 'http-fixture', version: '1.0.0' },
      { capabilities: { tools: {} } },
    )
    mcp.registerTool('ping', { description: 'Replies pong.', inputSchema: z.object({}) }, async (): Promise<CallToolResult> => {
      calls.push('ping')
      return { content: [{ type: 'text', text: 'pong' }] }
    })
    return mcp
  })
  const handle = toNodeHandler(handler)
  const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    await handle(request as NodeIncomingMessageLike, response)
  }
  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error: unknown) => {
      response.writeHead(500).end(String(error))
    })
  })
  const listening: PromiseWithResolvers<void> = Promise.withResolvers()
  server.listen(0, '127.0.0.1', listening.resolve)
  await listening.promise
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('HTTP MCP fixture has no TCP address')
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    calls,
    close: async () => {
      await handler.close()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error === undefined) resolve(); else reject(error) })
      })
    },
  }
}

/** Durable tool-call row captured from the session log. */
export interface LoggedToolCall {
  readonly sessionId: string
  readonly callId: string
  readonly name: string
}

/** Durable tool-result row captured from the session log. */
export interface LoggedToolResult {
  readonly sessionId: string
  readonly callId: string
  readonly isError: boolean
  readonly text: string
}

/** Durable PTC dispatch-start row. */
export interface LoggedPtcStart {
  readonly sessionId: string
  readonly name: string
  readonly subCallId: string
}

/** Durable PTC dispatch-result row. */
export interface LoggedPtcDispatch {
  readonly sessionId: string
  readonly name: string
  readonly subCallId: string
  readonly isError: boolean
  readonly text: string
  readonly errorCode: string | undefined
}

/** Session rows these tests assert against. */
export interface GuardLog {
  readonly toolCalls: LoggedToolCall[]
  readonly toolResults: LoggedToolResult[]
  readonly ptcStarts: LoggedPtcStart[]
  readonly ptcDispatches: LoggedPtcDispatch[]
  readonly userTexts: string[]
}

/** In-process PTC runtime. Programs run `behavior` instead of evaluating source. */
export class ScriptedPtcRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'fake'
  /** How many times `run` was entered. A guard denial never increments this. */
  runCount = 0
  behavior: (spec: PtcRunSpec) => Promise<PtcRunResult> = () => Promise.resolve({ logs: [], value: 'program' })

  constructor(ctx: Context, _config?: unknown) {
    super(ctx)
  }

  /** @param request - Program and bindings the tool registry hands the runtime. */
  resolve(request: PtcRunRequest): PtcRunSpec {
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: request.timeoutMs ?? 120_000 }
  }

  /** @param spec - Resolved program. The body is the test's `behavior`. */
  run(spec: PtcRunSpec): Promise<PtcRunResult> {
    this.runCount += 1
    return this.behavior(spec)
  }
}

/** One producing-step guard world. */
export interface GuardWorld<Runtime extends PtcRuntime = ScriptedPtcRuntime> {
  readonly ctx: Context
  readonly service: SessionDecisionsService
  readonly agent: Agent
  readonly runtime: Runtime
  readonly mcpCalls: readonly string[]
  readonly log: GuardLog
  readonly probeRuns: { current: number }
}

/** One model response: fixed chunks, or chunks computed from the request. */
type ScriptEntry = StreamChunk[] | ((options: GenerateOptions) => StreamChunk[] | Promise<StreamChunk[]>)

/** Scripted adapter: each model call consumes the next entry. */
class ScriptAdapter extends LlmAdapter {
  constructor(private readonly script: ScriptEntry[]) {
    super()
  }

  /** @param provider - Requested provider id. @param model - Requested model id. */
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  /** @param options - Live model request. */
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('ScriptAdapter: script exhausted')
    for (const chunk of typeof entry === 'function' ? await entry(options) : entry) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

/** Text response: one text block and a clean stop. */
export function textChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** One model response that requests the given tool calls. */
export function toolCallChunks(calls: ReadonlyArray<{ id: string; name: string; args: object }>): StreamChunk[] {
  const chunks: StreamChunk[] = []
  for (const [index, call] of calls.entries()) {
    const json = JSON.stringify(call.args)
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id: ToolCallId(call.id), name: call.name, argumentsDelta: json },
      { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: json } },
    )
  }
  chunks.push(
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

function blockText(content: readonly { type: string; text?: string }[]): string {
  return content.map(part => part.type === 'text' && part.text !== undefined ? part.text : '').join('')
}

function serviceConfig(): SessionDecisionsConfig {
  return {
    enabled: true,
    feishuEnabled: false,
    defaultTtlMs: 24 * 60 * 60 * 1000,
    closedRetentionMs: 30 * 24 * 60 * 60 * 1000,
    maxRecords: 1000,
    maxQuestionBytes: 16384,
    maxChoiceLabelBytes: 512,
    maxAnswerTextBytes: 16384,
    maxChoices: 8,
    reconcileMaxEvents: 100_000,
  }
}

/** Fail the decisions unit's Nth durable put, counting from 1. */
function failDecisionPuts(ctx: Context, from: number): void {
  let puts = 0
  const storage = ctx.get('storage')
  if (storage === undefined) throw new Error('fixture: storage hub missing')
  const facet = storage.backend.get('json').kv
  if (facet === undefined) throw new Error('fixture: json backend has no kv facet')
  const realOpen = facet.open.bind(facet)
  facet.open = async (descriptor: KvUnitDescriptor): Promise<KvUnit> => {
    const unit = await realOpen(descriptor)
    if (descriptor.name !== decisionsDomain.name) return unit
    const realPutRecord = unit.putRecord.bind(unit)
    return {
      loadAll: () => unit.loadAll(),
      putRecord: async (table, key, value) => {
        puts += 1
        if (puts >= from) throw new Error('fixture: decision write failed')
        return realPutRecord(table, key, value)
      },
      deleteRecord: (table, key) => unit.deleteRecord(table, key),
      setGlobal: value => unit.setGlobal(value),
      close: () => unit.close(),
    }
  }
}

interface GuardWorldOptions {
  readonly script?: ScriptEntry[]
  readonly realTurn?: boolean
  readonly failWritesFrom?: number
}

/** Mount the original scripted runtime world. */
export function openGuardWorld(options?: GuardWorldOptions): Promise<GuardWorld>
/** Mount a caller-owned runtime with the fixture's private temporary cwd. */
export function openGuardWorld(options: GuardWorldOptions & {
  readonly mountRuntime: (ctx: Context, cwd: string) => Promise<PtcRuntime>
}): Promise<GuardWorld<PtcRuntime>>
/**
 * Mount storage, the real agent loop, question tools, and a local MCP bridge.
 * @param options - Model script, failing writes, or an alternate runtime mount.
 * @returns The live world, with disposal registered with the test.
 */
export async function openGuardWorld(options: GuardWorldOptions & {
  readonly mountRuntime?: (ctx: Context, cwd: string) => Promise<PtcRuntime>
} = {}): Promise<GuardWorld<PtcRuntime>> {
  const root = await mkdtemp(join(tmpdir(), 'session-decisions-guards-'))
  const ctx = new Context()
  const fixture = await startLocalMcpFixture()
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    await fixture.close()
    await rm(root, { recursive: true, force: true })
  })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(SessionPersistenceJsonl, { root: join(root, 'sessions'), compression: 'none' })
  if (options.failWritesFrom !== undefined) failDecisionPuts(ctx, options.failWritesFrom)
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'both' } })
  let runtime: PtcRuntime
  if (options.mountRuntime === undefined) {
    await ctx.plugin(ScriptedPtcRuntime)
    runtime = ctx.ptcRuntime
  } else {
    runtime = await options.mountRuntime(ctx, root)
  }
  const cwd = options.mountRuntime === undefined ? '/workspace' : root
  const probeRuns = { current: 0 }
  ctx.tools.register(defineTool({
    name: PROBE,
    description: 'Records that its body ran.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value: string) => [{ type: 'text', text: value }],
    },
    async execute() {
      probeRuns.current += 1
      return 'ran'
    },
  }))
  await apply(ctx, {
    transport: 'streamable-http',
    serverName: 'guardfix',
    url: fixture.url,
    headers: {},
    toolCallTimeoutMs: 10_000,
    failOnStartupError: true,
    reconnect: { enabled: false, initialDelayMs: 50, maxDelayMs: 50, maxAttempts: 1 },
  })
  if (options.realTurn === true) ctx.llm.registerAdapter(['mock'], new ScriptAdapter(options.script ?? []))
  const loop = await mountAgentLoopTestHarness(ctx)
  const agent = await loop.create(
    GUARD_SESSION,
    options.realTurn === true ? { provider: 'mock', model: 'mock' } : {},
    { cwd },
  )
  ctx.provide('typert', {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
  } as never)
  ctx.provide('attachments', {
    admitPromptContent: async (
      content: readonly AttachmentAdmissionPart[],
    ): Promise<AdmittedPromptContentPart[]> => {
      const admitted: AdmittedPromptContentPart[] = []
      for (const part of content) {
        if (part.type === 'image') throw new Error('fixture did not configure image persistence')
        admitted.push(part)
      }
      return admitted
    },
  } as never)
  ctx.provide('fileUploads', {
    resolve: () => undefined,
    bindPrompt: () => ({ commit: () => {}, [Symbol.dispose]: () => {} }),
    retirePrompt: () => {},
  } as never)
  const controller = new SessionCommandController(ctx, new ApiSessionAgentController(ctx), cwd)
  ctx.provide('sessionController', {
    prompt: (request: SessionPromptRequest) => controller.prompt(request),
  } as never)
  await ctx.plugin(SessionDecisionsService, serviceConfig())
  await ctx.plugin(tools, {})
  const log: GuardLog = { toolCalls: [], toolResults: [], ptcStarts: [], ptcDispatches: [], userTexts: [] }
  ctx.on('session/event', (session, event) => {
    if (event.type === 'user/message') {
      log.userTexts.push(blockText(event.data.content))
      return
    }
    if (event.type === 'tool/call') {
      log.toolCalls.push({ sessionId: session.id, callId: event.data.callId, name: event.data.name })
      return
    }
    if (event.type === 'tool/result') {
      log.toolResults.push({
        sessionId: session.id,
        callId: event.data.message.toolCallId,
        isError: event.data.message.isError === true,
        text: blockText(event.data.message.content),
      })
      return
    }
    if (event.type === 'tool/ptc-dispatch-start') {
      log.ptcStarts.push({ sessionId: session.id, name: event.data.name, subCallId: event.data.subCallId })
      return
    }
    if (event.type === 'tool/ptc-dispatch') {
      log.ptcDispatches.push({
        sessionId: session.id,
        name: event.data.name,
        subCallId: event.data.subCallId,
        isError: event.data.isError,
        text: blockText(event.data.content),
        errorCode: event.data.error?.code,
      })
    }
  })
  return {
    ctx,
    service: ctx.sessionDecisions,
    agent,
    runtime,
    mcpCalls: fixture.calls,
    log,
    probeRuns,
  }
}

/** Queue one ordinary user message on the loop agent. */
export function askUser(agent: Agent, text: string): void {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
}
