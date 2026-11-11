import { addAbortListener } from 'node:events'
/**
 * B1.5 real-Host coverage for the persistent-questions feature over the
 * shipped Web composition: question production through the real AgentLoop
 * tool path, exact answer identity, lifecycle refusals, Goal interplay,
 * supersession, and crash-style saved-roots restart recovery. Public-path
 * cases ride the real boundaries — `sessionController.create/prompt` for
 * sessions and the actual Typert gateway (`typertGateway.invoke`) for the
 * feature's Remote surface; the mock is ONLY the LLM adapter (scripted
 * streams with async gates), supplied through the real default-model
 * selection API. Direct `ctx.get('sessionDecisions')` reads appear only in
 * race/fault internals and are labelled as such. Goldens carry raw
 * evidence, not normalized surfaces.
 *
 * Restart cases follow the durable-roots checkpoint protocol: copy
 * caller-owned persistence/storage roots while live, before any graceful
 * disposal, then relaunch over the copies with the same caller-owned
 * workspaceCwd.
 *
 * @module tests/persistent-questions
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { } from '@deepseek-ai/dsh-agent-default-model'
import type { } from '@deepseek-ai/dsh-api-gateway'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { } from '@deepseek-ai/dsh-experimental-agent-team'
import type { AnswerSubmitOutcome,AnswerSubmitPayload,DecisionId,DecisionView } from '@deepseek-ai/dsh-experimental-session-decisions/types'
import type { } from '@deepseek-ai/dsh-goal'
import type { GenerateOptions,LlmResolvedModelInfo,StreamChunk,UserMessage } from '@deepseek-ai/dsh-llm'
import { LlmAdapter,ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { cp,mkdir,mkdtemp,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach,expect } from 'vitest'
import {
  fixtureIdentity,launchWebScaffold,readPersistedEvents,
  webSnapshotMode,type WebScaffold,
} from './scaffold.ts'

if (webSnapshotMode() === 'record') {
  throw new Error('persistent-questions scenarios are synthetic (scripted adapter); use DSH_SNAPSHOT=refresh, not record')
}

export const SCENARIO_DIR = fileURLToPath(new URL('../../../snapshots/web/persistent-questions', import.meta.url))
export const BUSY_TEAM_DIR = fileURLToPath(new URL('../../../snapshots/web/persistent-questions-busy-team', import.meta.url))
export const FEATURE_PKG = fileURLToPath(new URL('../../../packages/experimental/session-decisions', import.meta.url))
export const AGENT_TEAM_PKG = fileURLToPath(new URL('../../../packages/experimental/agent-team-profile', import.meta.url))

export const PROVIDER = 'decision-script'
export const MODEL = 'decision-model'

/** Stable identity for one restart world. */
export interface DurableRoots {
  readonly persistenceRoot: string
  readonly storageRoot: string
  readonly workspaceCwd: string
}

/** Caller-owned restart world: three root directories under one temp home. */
/**
 * Copy a flushed caller-owned root at a crash barrier. The JSON storage
 * backend publishes single-unit files by temp+rename, so a concurrent
 * in-flight publish can unlink a `.tmp` entry mid-walk; a bounded retry on
 * ENOENT makes the barrier copy see the settled medium without sleeping on
 * model timing.
 */
export async function copyRoot(source: string, target: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await cp(source, target, { recursive: true })
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      lastError = error
    }
  }
  throw lastError
}

/**
 * Latest goal-tool result revision from the conversation so far: goal
 * mutations (disarm, resume) bump the revision between scripted entries, so
 * later tool args must read the live value the model just observed.
 */
export function latestGoalRevision(options: GenerateOptions): number | undefined {
  const texts = options.messages
    .filter(message => message.role === 'tool')
    .flatMap(message => Array.isArray(message.content) ? message.content as readonly { type: string; text?: string }[] : [])
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .filter(text => text.includes('"goal"'))
  const last = texts[texts.length - 1]
  return last === undefined ? undefined : (JSON.parse(last) as { goal?: { revision?: number } }).goal?.revision
}

export async function durableWorld(): Promise<{ home: string; roots: DurableRoots }> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-persistent-questions-'))
  const roots: DurableRoots = {
    persistenceRoot: join(home, 'sessions'),
    storageRoot: join(home, 'storage'),
    workspaceCwd: join(home, 'workspace'),
  }
  const { persistenceRoot, storageRoot, workspaceCwd } = roots
  await Promise.all([persistenceRoot, storageRoot, workspaceCwd].map(dir => mkdir(dir, { recursive: true })))
  return { home, roots }
}

/** Text response script entry: one text block, usage, clean stop. */
export function textChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** One-response script entry streaming the given tool calls. */
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

/** Script entry: fixed chunks, or computed after an async gate holds. */
export type ScriptEntry = StreamChunk[] | ((options: GenerateOptions) => StreamChunk[] | Promise<StreamChunk[]>)

/**
 * Scripted LLM adapter: each model call consumes the next script entry.
 * Gates are plain awaited promises inside entry functions, so a held stream
 * keeps the owning turn running with no sleeps.
 */
export class ScriptAdapter extends LlmAdapter {
  readonly calls: GenerateOptions[] = []

  constructor(private readonly script: ScriptEntry[]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('persistent-questions ScriptAdapter: script exhausted')
    for (const chunk of typeof entry === 'function' ? await entry(options) : entry) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

export type SessionEvents = Awaited<ReturnType<typeof readPersistedEvents>>

/** Bounded stage diagnostics for the exact awaited point of a hang (stderr). */
export function stage(label: string): void {
  console.error(`[pq-stage] ${label}`)
}

/**
 * Boot the real Web scaffold with the feature mounted through its own
 * shipped `cordis.patch.yml` (the same layer the source Web CLI installs),
 * keeping the real profile + feature-patch load order; no test-side
 * reordering or post-start hand-mounting. The agent-team bundle joins the
 * same way for the busy-team scenario.
 */
export function questionsFixture(withAgentTeam: boolean): {
  extraOverlayPath: string[]
  extraInstallAnchors: string[]
} {
  return {
    extraOverlayPath: [
      FEATURE_PKG + '/cordis.patch.yml',
      FEATURE_PKG + '/preset.cordis.yml',
      ...(withAgentTeam ? [AGENT_TEAM_PKG + '/cordis.patch.yml'] : []),
    ],
    extraInstallAnchors: [
      FEATURE_PKG + '/package.json',
      ...(withAgentTeam ? [AGENT_TEAM_PKG + '/package.json'] : []),
    ],
  }
}

export async function launchQuestions(
  roots: DurableRoots,
  options: { sessionSearch?: 'never'; withAgentTeam?: boolean; withFeishu?: boolean } = {},
): Promise<WebScaffold> {
  const fixture = questionsFixture(options.withAgentTeam === true)
  if (options.withFeishu) {
    const desktopIm = fileURLToPath(new URL('../../../packages/experimental/desktop-im', import.meta.url))
    const patch = join(roots.storageRoot, 'feishu-questions.patch.yml')
    await writeFile(patch, [
      '- id: desktop-im', '  config:', `    settingsDirectory: ${JSON.stringify(join(roots.storageRoot, 'desktop-im'))}`,
      '- id: session-decisions', '  config:', '    feishuEnabled: true',
    ].join('\n') + '\n')
    fixture.extraInstallAnchors.push(desktopIm + '/package.json')
    fixture.extraOverlayPath.push(desktopIm + '/cordis.patch.yml', patch)
  }
  return launchWebScaffold({
    durableRoots: roots,
    ...(options.sessionSearch === undefined ? {} : { sessionSearch: options.sessionSearch }),
    ...fixture,
  })
}

/**
 * Register the scripted adapter as the sole route for its provider and pin
 * it through the real default-model selection API, so no session can fall
 * back to the lane's deepseek-official replay route.
 */
export async function installAdapter(scaffold: WebScaffold, script: ScriptEntry[]): Promise<ScriptAdapter> {
  const adapter = new ScriptAdapter(script)
  scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter([PROVIDER], adapter), 'persistent-questions script adapter')
  await scaffold.ctx.agentDefaultModel.saveSelection({ provider: PROVIDER, model: MODEL })
  return adapter
}

/** Real public session creation on the feature preset through the controller. */
export async function createQuestionSession(scaffold: WebScaffold): Promise<string> {
  const created = await scaffold.ctx.sessionController.create({
    cwd: scaffold.workspaceCwd,
    agentPreset: 'persistent-questions',
  })
  return created.sessionId
}

/** The live Agent of one session (public registry read). */
export function liveAgent(scaffold: WebScaffold, sessionId: string): Agent {
  const agent = scaffold.ctx.agents.get(SessionId(sessionId))
  if (agent === undefined) throw new Error(`no live agent for session ${sessionId}`)
  return agent
}

/** Settle one session: idle flip, then the durability flush barrier. */
export async function settleSession(scaffold: WebScaffold, sessionId: string): Promise<void> {
  const agent = liveAgent(scaffold, sessionId)
  await agent.whenIdle()
  await scaffold.ctx.sessions.flush(agent.session)
}

/** Hold the real question tool after saving so an answer queues behind its producing turn.
 * @param scaffold - Running Host composition.
 * @returns A saved-question gate whose release is also owned by Host teardown.
 */
export function holdQuestionTurn(scaffold: WebScaffold): { saved: Promise<void>; release: () => void } {
  const saved = Promise.withResolvers<undefined>()
  const released = Promise.withResolvers<undefined>()
  let held = false
  const release = () => { released.resolve(undefined) }
  scaffold.ctx.effect(() => release, 'release held question turn')
  scaffold.ctx.on('tools/execute', async (exec, next) => {
    const result = await next()
    if (!held && exec.name === 'request_persistent_question') {
      held = true
      saved.resolve(undefined)
      const abortListener = addAbortListener(exec.signal, release)
      try { await released.promise } finally { abortListener[Symbol.dispose]() }
    }
    return result
  })
  return { saved: saved.promise, release }
}

export let promptOrdinal = 0
// Scope the rpc ordinal to one test: goldens embed the deterministic
// fixtureIdentity('rpc', n) value, so a filtered single-case run must produce
// the same ids as the whole-file run. The counter keeps advancing across cold
// relaunch scaffolds within the same case.
beforeEach(() => {
  promptOrdinal = 0
})

/** Allocate a deterministic prompt identity within the current scenario.
 * @returns A fresh request identity, with the counter retained across cold restores.
 */
export function nextPromptRequestId(): SessionRequestId {
  promptOrdinal += 1
  return brandString<SessionRequestId>(fixtureIdentity('rpc', promptOrdinal))
}

/** One ordinary desktop-equivalent input through the real prompt controller. */
export async function promptSession(scaffold: WebScaffold, sessionId: string, text: string): Promise<void> {
  promptOrdinal += 1
  await scaffold.ctx.sessionController.prompt({
    requestId: brandString<SessionRequestId>(fixtureIdentity('rpc', promptOrdinal)),
    sessionId: SessionId(sessionId),
    mode: 'queue',
    content: [{ type: 'text', text }],
  }, new AbortController().signal)
  await settleSession(scaffold, sessionId)
}

/** Actual public Remote call over the real Typert gateway (validated args). */
export async function gatewayInvoke(scaffold: WebScaffold, method: string, args: Record<string, unknown>): Promise<unknown> {
  return scaffold.ctx.typertGateway.invoke({ namespace: 'sessionDecisions', method, args })
}

/** Remote catalog over the gateway. */
export async function remoteCatalog(scaffold: WebScaffold, sessionId: string): Promise<DecisionView[]> {
  return await gatewayInvoke(scaffold, 'catalog', { sessionId: SessionId(sessionId) }) as DecisionView[]
}

/** Remote get over the gateway. */
export async function remoteGet(scaffold: WebScaffold, decisionId: DecisionId): Promise<DecisionView | undefined> {
  return await gatewayInvoke(scaffold, 'get', { decisionId }) as DecisionView | undefined
}

/** Remote submit over the gateway: the real public admission path. */
export async function remoteSubmit(
  scaffold: WebScaffold,
  decisionId: DecisionId,
  expectedRevision: number,
  requestId: SessionRequestId,
  payload: AnswerSubmitPayload,
): Promise<AnswerSubmitOutcome> {
  return await gatewayInvoke(scaffold, 'submit', { decisionId, expectedRevision, requestId, payload }) as AnswerSubmitOutcome
}

/** The one decision of a session over the gateway Remote catalog. */
/** The one OPEN decision for a session; closed/superseded records stay in the catalog under closed retention. */
export async function soleOpenDecision(scaffold: WebScaffold, sessionId: string): Promise<DecisionView> {
  const catalog = await remoteCatalog(scaffold, sessionId)
  const open = catalog.filter(view => view.lifecycle === 'open')
  expect(open, `exactly one open decision for ${sessionId}`).toHaveLength(1)
  return open[0] as DecisionView
}

export async function soleDecision(scaffold: WebScaffold, sessionId: string): Promise<DecisionView> {
  const catalog = await remoteCatalog(scaffold, sessionId)
  expect(catalog, `exactly one decision for ${sessionId}`).toHaveLength(1)
  return catalog[0] as DecisionView
}

/** Text of a live inbox message (queued pending input). */
export function messageTextOf(message: UserMessage): string {
  return message.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/** Persisted user-message texts in turn order, through the real JSONL backend. */
export function enteredUserTexts(events: SessionEvents): string[] {
  return events.flatMap((event) => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') return []
    return [event.data.content.filter(block => block.type === 'text').map(block => block.text).join('')]
  })
}

/** Entered user-message sources (kind + rpcId correlation evidence). */
export function enteredUserSources(events: SessionEvents): Array<{ kind: string; rpcId?: string | undefined }> {
  return events.flatMap((event) => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') return []
    const source = event.data.source
    return [{ kind: source.kind, rpcId: 'rpcId' in source ? source.rpcId : undefined }]
  })
}

/** Raw persisted evidence of one tool's calls, in log order. */
export function toolCalls(events: SessionEvents, name: string): Array<{ callId: string; arguments: string }> {
  return events.flatMap((event) => {
    if (event.type !== 'tool/call' || event.data.name !== name) return []
    return [{ callId: event.data.callId, arguments: event.data.arguments }]
  })
}

/** Raw persisted evidence of one tool's results, in log order. */
export function toolResults(events: SessionEvents, name: string): Array<{
  callId: string
  isError: boolean
  body: string
  meta: unknown
}> {
  const callNames = new Map(events.flatMap((event) => {
    if (event.type !== 'tool/call') return []
    return [[event.data.callId, event.data.name] as const]
  }))
  return events.flatMap((event) => {
    if (event.type !== 'tool/result' || callNames.get(event.data.message.toolCallId) !== name) return []
    return [{
      callId: event.data.message.toolCallId,
      isError: event.data.message.isError === true,
      body: event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join(''),
      meta: event.data.meta,
    }]
  })
}

/** Stable JSON: object keys sorted, arrays in order, one line. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

/** Stable golden text: known ids and timestamps collapse to ordered tokens. */
export class Golden {
  #sections: string[] = []
  #decisionTokens = new Map<DecisionId, string>()
  #sessionTokens = new Map<string, string>()
  #goalTokens = new Map<string, string>()

  session(sessionId: string): this {
    if (!this.#sessionTokens.has(sessionId)) {
      this.#sessionTokens.set(sessionId, `{{session:${this.#sessionTokens.size + 1}}}`)
    }
    return this
  }

  decision(decisionId: DecisionId): this {
    if (!this.#decisionTokens.has(decisionId)) {
      this.#decisionTokens.set(decisionId, `{{decisionId:${this.#decisionTokens.size + 1}}}`)
    }
    return this
  }

  /** Map one generated Goal id to a stable golden token (goal tool traces embed it raw). */
  goal(goalId: string): this {
    if (!this.#goalTokens.has(goalId)) {
      this.#goalTokens.set(goalId, `{{goalId:${this.#goalTokens.size + 1}}}`)
    }
    return this
  }

  add(label: string, value: unknown): this {
    this.#sections.push(`## ${label}\n${this.#tokenize(stableJson(value))}`)
    return this
  }

  #tokenize(text: string): string {
    let output = text
    for (const [sessionId, token] of this.#sessionTokens) output = output.split(sessionId).join(token)
    for (const [decisionId, token] of this.#decisionTokens) output = output.split(decisionId).join(token)
    for (const [goalId, token] of this.#goalTokens) output = output.split(goalId).join(token)
    return output.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '{{iso}}')
  }

  render(): string {
    return this.#sections.join('\n\n')
  }
}
