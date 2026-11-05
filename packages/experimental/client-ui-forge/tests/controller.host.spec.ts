import { watch, type FSWatcher } from 'node:fs'
/** Local Git controls exercise the real Agent driver and Session replay. */
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { git, harness, repository } from './harness.ts'
import ForgePanel from '../src/index.ts'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
const watchers: FSWatcher[] = []
let ctx: Context | undefined
let root: string | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  for (const watcher of watchers.splice(0)) watcher.close()
  await ctx?.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})
async function fixture(blockCheckout = false, worktrees = true, panel = true) {
  root = await repository()
  let gitCommand: string | undefined
  if (blockCheckout) {
    gitCommand = join(root, 'git-wrapper')
    await writeFile(gitCommand, `#!/bin/sh
case "$*" in
  *"worktree add"*) printf started > "${root}/checkout-started"; while ! test -f "${root}/checkout-release"; do /bin/sleep 0.01; done;;
esac
exec git "$@"
`)
    await chmod(gitCommand, 0o700)
  }
  ctx = await harness(root, gitCommand === undefined ? {} : { gitCommand }, worktrees)
  const adapter = new MockAdapter([textResponse('done'), textResponse('continued'), textResponse('restored'), textResponse('resumed')])
  ctx.llm.registerAdapter(['mock'], adapter)
  if (panel) await ctx.plugin(ForgePanel)
  const agent = await ctx.agentLoop.create(SessionId('panel-lead'), { provider: 'mock', model: 'mock' }, { cwd: root })
  return { ctx, root, agent, adapter, signal: new AbortController().signal }
}
function message() { return createUserMessage({ content: [{ type: 'text', text: 'Read the checkout.' }], source: { kind: 'user' } }) }
describe('local worktree controller', () => {
  it('creates before model admission and replays directory state without rewriting origin', async () => {
    const f = await fixture()
    f.ctx.forgePanel.requestWorktree(f.agent.session, null, f.signal)
    expect(f.ctx.workingDirectory.get(f.agent.session)).toBe(f.root)
    f.agent.followup(message()); await f.agent.whenIdle()
    const directory = f.ctx.workingDirectory.get(f.agent.session)
    expect(directory).not.toBe(f.root)
    expect(f.agent.session.header.cwd).toBe(f.root)
    expect(f.adapter.requests.length).toBeGreaterThan(0)
    const text = f.adapter.requests[0]!.messages.flatMap(item => item.content).map(block => block.type === 'text' ? block.text : '').join('\n')
    expect(text).toContain(directory)
    const events = f.agent.session.snapshotEvents()
    expect(events.findIndex(event => event.type === 'working-directory/change')).toBeLessThan(events.findIndex(event => event.type === 'step/start'))
    const cold = Session.create(SessionId('cold-panel'), events, { ...f.agent.session.header, id: SessionId('cold-panel') })
    expect(f.ctx.workingDirectory.get(cold)).toBe(directory)
    expect(f.ctx.sessionProjections.snapshot(cold).values.forgeWorktree?.path).toBe(directory)
    expect(cold.header.cwd).toBe(f.root)
    expect(() =>{  f.ctx.forgePanel.requestWorktree(f.agent.session, null, f.signal) }).toThrow('Session has started')
  })
  it('withdraws a pending request without creating a checkout', async () => {
    const f = await fixture()
    f.ctx.forgePanel.requestWorktree(f.agent.session, null, f.signal)
    f.ctx.forgePanel.cancelWorktree(f.agent.session, f.signal)
    f.agent.followup(message()); await f.agent.whenIdle()
    expect(f.ctx.workingDirectory.get(f.agent.session)).toBe(f.root)
    expect(f.agent.session.snapshotEvents().filter(event => event.type === 'worktree/record').map(event => event.data.action)).toEqual(['request', 'cancel'])
  })
  it('restores a missing checkout without changing cwd and returns to the original project', async () => {
    const f = await fixture()
    f.ctx.forgePanel.requestWorktree(f.agent.session, null, f.signal)
    f.agent.followup(message()); await f.agent.whenIdle()
    const directory = f.ctx.workingDirectory.get(f.agent.session)
    await f.ctx.forgePanel.restoreWorktree(f.agent.session, f.signal)
    expect(f.agent.session.snapshotEvents().some(event => event.type === 'worktree/record' && event.data.action === 'restoring')).toBe(false)
    await rm(directory, { recursive: true, force: true })
    await f.ctx.workingDirectory.ensure(f.agent)
    expect(f.ctx.workingDirectory.get(f.agent.session)).toBe(f.root)
    await f.ctx.forgePanel.restoreWorktree(f.agent.session, f.signal)
    expect(f.ctx.workingDirectory.get(f.agent.session)).toBe(f.root)
    await f.ctx.workingDirectory.set(f.agent, directory)
    await writeFile(join(directory, 'local.txt'), 'uncommitted\n')
    expect((await f.ctx.forgePanel.localDiff(f.agent.session, { kind: 'uncommitted' }, f.signal)).files.some(file => file.path === 'local.txt')).toBe(true)
    await f.ctx.forgePanel.continueInProject(f.agent.session, f.signal)
    expect(f.ctx.workingDirectory.get(f.agent.session)).toBe(f.root)
  })
  it('exposes no publication, merge, or change-request method', async () => {
    const f = await fixture()
    for (const name of ['merge', 'submitReview', 'markReady', 'track', 'dismiss', 'refresh']) expect(name in f.ctx.forgePanel).toBe(false)
  })
})

async function panelUntil(context: Context, session: Session, matches: (state: import('../src/types.ts').ForgePanelState) => boolean) {
  const control = new AbortController()
  try {
    for await (const state of context.forgePanel.follow(session, control.signal)) if (matches(state)) return state
    throw new Error('Panel ended before the required observation')
  } finally { control.abort() }
}

it('retains a failed request for retry and enters only a successful actual checkout', async () => {
  const f = await fixture()
  f.ctx.forgePanel.requestWorktree(f.agent.session, 'later-base', f.signal)
  const failed = panelUntil(f.ctx, f.agent.session, state => state.worktree.failure !== null && state.worktree.waiting === 'creation')
  f.agent.followup(message())
  const waiting = await failed
  expect(waiting.worktree.failure?.message).toContain('Needed a single revision')
  expect(waiting.worktree.request?.from).toBe('later-base')
  expect(f.adapter.requests).toHaveLength(0)
  expect(f.ctx.workingDirectory.get(f.agent.session)).toBe(f.root)
  await git(f.root, 'branch', 'later-base', 'HEAD')
  f.ctx.forgePanel.retryWorktree(f.agent.session, f.signal)
  await f.agent.whenIdle()
  expect(f.ctx.workingDirectory.get(f.agent.session)).not.toBe(f.root)
  expect(f.adapter.requests.length).toBeGreaterThan(0)
})

it('stops a real checkout process, then cancels the waiting request without directory admission', async () => {
  const f = await fixture(true)
  f.ctx.forgePanel.requestWorktree(f.agent.session, null, f.signal)
  const started = Promise.withResolvers<undefined>()
  const watcher = watch(f.root, (_event, filename) => { if (filename === 'checkout-started') started.resolve(undefined) })
  watchers.push(watcher)
  f.agent.followup(message())
  await started.promise
  expect(() => { f.ctx.forgePanel.requestWorktree(f.agent.session, null, f.signal) }).toThrow('being created')
  const stopped = panelUntil(f.ctx, f.agent.session, state => state.worktree.creation === null && state.worktree.waiting === 'creation')
  f.ctx.forgePanel.stopCreation(f.agent.session, f.signal)
  await stopped
  expect(f.adapter.requests).toHaveLength(0)
  expect(f.agent.session.snapshotEvents().some(event => event.type === 'working-directory/change')).toBe(false)
  f.ctx.forgePanel.cancelWorktree(f.agent.session, f.signal)
  await f.agent.whenIdle()
  expect(f.ctx.workingDirectory.get(f.agent.session)).toBe(f.root)
  expect(f.adapter.requests.length).toBeGreaterThan(0)
})

it('cold-opens required worktree records through real JSONL persistence', async () => {
  const f = await fixture()
  f.ctx.forgePanel.requestWorktree(f.agent.session, null, f.signal)
  f.agent.followup(message())
  await f.agent.whenIdle()
  await f.ctx.plugin(JsonlPersistence, { root: join(f.root, 'session-logs'), compression: 'none' })
  const writer = await f.ctx.sessionPersistence.create(f.agent.session.header)
  await writer.append(f.agent.session.snapshotEvents())
  await writer.close()
  const reader = await f.ctx.sessionPersistence.open(f.agent.id, 'read')
  try {
    const log = await reader.read()
    const cold = Session.create(f.agent.id, log.events, reader.header)
    expect(cold.deriveMessages()).toEqual(f.agent.session.deriveMessages())
    expect(f.ctx.sessionProjections.snapshot(cold).values.forgeWorktree?.path).toBe(f.ctx.workingDirectory.get(cold))
    expect(cold.snapshotEvents().filter(event => event.type === 'worktree/record').map(event => event.data.action)).toEqual(['request', 'created'])
  } finally { await reader.close() }
})

it('refuses unavailable composition, empty bases and control requests without held work', async () => {
  const f = await fixture(false, false)
  expect(() => { f.ctx.forgePanel.requestWorktree(f.agent.session, null, f.signal) }).toThrow('No worktree service')
  expect(() => { f.ctx.forgePanel.requestWorktree(f.agent.session, '', f.signal) }).toThrow('base branch name is empty')
  expect(() => { f.ctx.forgePanel.retryWorktree(f.agent.session, f.signal) }).toThrow('No message waits')
  f.ctx.forgePanel.cancelWorktree(f.agent.session, f.signal)
  f.ctx.forgePanel.stopCreation(f.agent.session, f.signal)
  await expect(f.ctx.forgePanel.restoreWorktree(f.agent.session, f.signal)).rejects.toThrow('no created worktree')
  await expect(f.ctx.forgePanel.continueInProject(f.agent.session, f.signal)).rejects.toThrow('no created worktree')
})

it('reads current text and rejects branch comparison before a checkout is created', async () => {
  const f = await fixture()
  expect(await f.ctx.forgePanel.localText(f.agent.session, { kind: 'uncommitted' }, 'tracked.txt', f.signal)).toBe('initial\n')
  await expect(f.ctx.forgePanel.localDiff(f.agent.session, { kind: 'branch' }, f.signal)).rejects.toThrow('no fork point')
  const control = new AbortController()
  control.abort(new Error('caller cancelled local reads'))
  await expect(f.ctx.forgePanel.localText(f.agent.session, { kind: 'uncommitted' }, 'tracked.txt', control.signal))
    .rejects.toThrow('caller cancelled local reads')
  expect(() => { f.ctx.forgePanel.requestWorktree(f.agent.session, null, control.signal) }).toThrow('caller cancelled local reads')
})

import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { forgeWorktreeProjection, WORKTREE_RECORD } from '../src/worktree.ts'
import type { ForgeSessionWorktree, ForgeWorktreeState } from '../src/types.ts'
const foldedContexts: Context[] = []
afterEach(async () => { await Promise.all(foldedContexts.splice(0).map(context => context.fiber.dispose())) })
const WORKTREE: ForgeSessionWorktree = {
  path: '/work/repo/.agents/worktrees/local', branch: 'local', from: null, baseCommit: 'c'.repeat(40), repositoryRoot: '/work/repo',
}
const EMPTY: ForgeWorktreeState = { request: null, created: null, locked: false, stepped: false, cwd: null, restoring: false }
async function folded() {
  const ctx = new Context()
  foldedContexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const states = await ctx.sessionProjections.register(forgeWorktreeProjection)
  const session = ctx.sessions.create(SessionId('forge-worktree-projection'))
  return { ctx, session, state: () => states.stateOf(session) }
}
function startTurn(session: Session, turn: number): void { session.append('turn/start', { turn }) }
function startStep(session: Session, turn: number, step = 1): void { session.append('step/start', { turn, step }) }
function plainSession(cwd: string): Session {
  const id = SessionId('projection-header')
  return Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, cwd })
}
describe('forgeWorktree projection', () => {
  it('shows clients the created worktree in the Session summary while the Session works in it', async () => {
    const { ctx, session, state } = await folded()
    const published: unknown[] = []
    ctx.sessionProjections.onChanged((_session, key, value) => { if (key === 'forgeWorktree') published.push(value) })

    session.append(WORKTREE_RECORD, { action: 'request', from: 'main' })
    session.append('working-directory/change', { cwd: WORKTREE.path })
    session.append(WORKTREE_RECORD, { action: 'created', worktree: WORKTREE })
    startTurn(session, 1)
    startStep(session, 1)
    session.append('working-directory/change', { cwd: join(WORKTREE.path, 'packages') })
    const inside = [...published]
    session.append('working-directory/change', { cwd: WORKTREE.repositoryRoot })
    // Shares the worktree's path as a string prefix without lying below it.
    session.append('working-directory/change', { cwd: `${WORKTREE.path}-sibling` })
    const outside = [...published]
    session.append('working-directory/change', { cwd: WORKTREE.path })
    const returned = state()
    session.append('working-directory/change', { cwd: WORKTREE.path })

    expect(state()).toBe(returned)
    expect(inside.at(-1)).toEqual(WORKTREE)
    expect(inside.filter(value => value !== null)).toEqual([WORKTREE])
    expect(outside.slice(inside.length)).toEqual([null])
    expect(published.slice(outside.length)).toEqual([WORKTREE])
    expect(ctx.sessionProjections.summaryKeys().has('forgeWorktree')).toBe(true)
  })

  it('starts from the directory the Session header records', () => {
    expect(forgeWorktreeProjection.init(plainSession('/work/repo').header)).toEqual({ ...EMPTY, cwd: '/work/repo' })
  })

  it('replays incomplete restoration until an explicit successful completion', async () => {
    const { session, state } = await folded()
    session.append(WORKTREE_RECORD, { action: 'restoring' })
    expect(state().restoring).toBe(false)
    session.append(WORKTREE_RECORD, { action: 'request', from: null })
    session.append(WORKTREE_RECORD, { action: 'created', worktree: WORKTREE })
    session.append(WORKTREE_RECORD, { action: 'restoring' })
    expect(state().restoring).toBe(true)
    const checkpoint = state()
    session.append(WORKTREE_RECORD, { action: 'restoring' })
    expect(state()).toBe(checkpoint)
    session.append(WORKTREE_RECORD, { action: 'restored' })
    expect(state().restoring).toBe(false)
    const restored = state()
    session.append(WORKTREE_RECORD, { action: 'restored' })
    expect(state()).toBe(restored)
  })

  it('starts without a request, a created worktree, a started turn, or a started step', async () => {
    const { state } = await folded()

    expect(state()).toEqual(EMPTY)
  })

  it('opens, replaces, and withdraws the request until the first turn starts', async () => {
    const { session, state } = await folded()

    session.append(WORKTREE_RECORD, { action: 'request', from: null })
    expect(state()?.request).toEqual({ from: null })
    session.append(WORKTREE_RECORD, { action: 'request', from: 'main' })
    expect(state()?.request).toEqual({ from: 'main' })
    session.append(WORKTREE_RECORD, { action: 'cancel' })
    const withdrawn = state()
    expect(withdrawn).toEqual(EMPTY)
    session.append(WORKTREE_RECORD, { action: 'cancel' })
    expect(state()).toBe(withdrawn)

    session.append(WORKTREE_RECORD, { action: 'request', from: 'feat' })
    startTurn(session, 1)
    const locked = state()
    expect(locked).toEqual({ ...EMPTY, request: { from: 'feat' }, locked: true })
    session.append(WORKTREE_RECORD, { action: 'request', from: 'main' })
    session.append(WORKTREE_RECORD, { action: 'cancel' })
    expect(state()).toBe(locked)
  })

  it('applies the first created worktree of an open request, after which requests, withdrawals, and creations change nothing', async () => {
    const { session, state } = await folded()
    session.append(WORKTREE_RECORD, { action: 'request', from: 'main' })

    session.append(WORKTREE_RECORD, { action: 'created', worktree: { ...WORKTREE, from: 'main' } })
    const created = state()
    session.append(WORKTREE_RECORD, { action: 'created', worktree: { ...WORKTREE, branch: 'dsh/ffffffff' } })
    session.append(WORKTREE_RECORD, { action: 'request', from: null })
    session.append(WORKTREE_RECORD, { action: 'cancel' })

    expect(created).toEqual({ ...EMPTY, request: { from: 'main' }, created: { ...WORKTREE, from: 'main' } })
    expect(state()).toBe(created)
  })

  it('applies a created worktree after the first turn starts, until the first step starts', async () => {
    const { session, state } = await folded()
    session.append(WORKTREE_RECORD, { action: 'request', from: null })
    startTurn(session, 1)

    session.append(WORKTREE_RECORD, { action: 'created', worktree: WORKTREE })
    const created = state()
    startStep(session, 1)

    expect(created).toEqual({ ...EMPTY, request: { from: null }, created: WORKTREE, locked: true })
    expect(state()).toEqual({ ...EMPTY, request: { from: null }, created: WORKTREE, locked: true, stepped: true })
  })

  it('ignores a created worktree without an open request or after the first step starts', async () => {
    const { session, state } = await folded()
    const initial = state()
    session.append(WORKTREE_RECORD, { action: 'created', worktree: WORKTREE })
    expect(state()).toBe(initial)

    session.append(WORKTREE_RECORD, { action: 'request', from: null })
    session.append(WORKTREE_RECORD, { action: 'cancel' })
    const withdrawn = state()
    session.append(WORKTREE_RECORD, { action: 'created', worktree: WORKTREE })
    expect(state()).toBe(withdrawn)

    session.append(WORKTREE_RECORD, { action: 'request', from: null })
    startTurn(session, 1)
    startStep(session, 1)
    const stepped = state()
    session.append(WORKTREE_RECORD, { action: 'created', worktree: WORKTREE })

    expect(stepped).toEqual({ ...EMPTY, request: { from: null }, locked: true, stepped: true })
    expect(state()).toBe(stepped)
  })

  it('counts only the first turn start and the first step start', async () => {
    const { session, state } = await folded()
    startTurn(session, 1)
    const locked = state()
    startTurn(session, 2)
    expect(state()).toBe(locked)

    startStep(session, 2)
    const stepped = state()
    startStep(session, 2, 2)
    startTurn(session, 3)

    expect(locked).toEqual({ ...EMPTY, locked: true })
    expect(stepped).toEqual({ ...EMPTY, locked: true, stepped: true, restoring: false })
    expect(state()).toBe(stepped)
  })

  it('ignores malformed worktree records, other plugin records, and other events', async () => {
    const { session, state } = await folded()
    session.append(WORKTREE_RECORD, { action: 'request', from: 'main' })
    const requested = state()
    const cancelWithReason = { action: 'cancel' as const, reason: 'stale' }

    session.append(WORKTREE_RECORD, { action: 'request', from: '' })
    session.append(WORKTREE_RECORD, cancelWithReason)
    session.append(WORKTREE_RECORD, { action: 'created', worktree: { ...WORKTREE, path: '' } })
    session.append(WORKTREE_RECORD, { action: 'created', worktree: { ...WORKTREE, repositoryRoot: '' } })
    session.append('step/end', { turn: 1, step: 1 })

    expect(state()).toBe(requested)
    expect(requested).toEqual({ ...EMPTY, request: { from: 'main' } })
  })
})


it('holds a new message for missing-checkout restoration before admitting another model request', async () => {
  const f = await fixture()
  f.ctx.forgePanel.requestWorktree(f.agent.session, null, f.signal)
  f.agent.followup(message())
  await f.agent.whenIdle()
  const directory = f.ctx.workingDirectory.get(f.agent.session)
  const before = f.adapter.requests.length
  await rm(directory, { recursive: true })
  const waiting = panelUntil(f.ctx, f.agent.session, state => state.worktree.waiting === 'restoration' && state.worktree.missing !== null)
  f.agent.followup(message())
  await waiting
  expect(f.adapter.requests).toHaveLength(before)
  await f.ctx.forgePanel.restoreWorktree(f.agent.session, f.signal)
  await f.agent.whenIdle()
  expect(f.ctx.workingDirectory.get(f.agent.session)).toBe(directory)
  expect(f.adapter.requests.length).toBeGreaterThan(before)
  expect(f.agent.session.header.cwd).toBe(f.root)
})

it('keeps a failed restoration held and lets return-to-project release the real message', async () => {
  const f = await fixture()
  f.ctx.forgePanel.requestWorktree(f.agent.session, null, f.signal)
  f.agent.followup(message())
  await f.agent.whenIdle()
  const directory = f.ctx.workingDirectory.get(f.agent.session)
  await rm(directory, { recursive: true })
  const before = f.adapter.requests.length
  const waiting = panelUntil(f.ctx, f.agent.session, state => state.worktree.waiting === 'restoration' && state.worktree.missing !== null)
  f.agent.followup(message())
  await waiting
  await writeFile(directory, 'An occupied checkout path must not be overwritten.')
  await expect(f.ctx.forgePanel.restoreWorktree(f.agent.session, f.signal)).rejects.toThrow()
  expect(f.adapter.requests).toHaveLength(before)
  await f.ctx.forgePanel.continueInProject(f.agent.session, f.signal)
  await f.agent.whenIdle()
  expect(f.ctx.workingDirectory.get(f.agent.session)).toBe(f.root)
  expect(f.adapter.requests.length).toBeGreaterThan(before)
  expect(f.agent.session.header.cwd).toBe(f.root)
})

it.each([
  [{ gitCommand: '' }, 'gitCommand must not be empty'],
  [{ gitTimeoutMs: 0 }, 'gitTimeoutMs must be a positive bounded integer'],
  [{ maxDiffBytes: 1.5 }, 'maxDiffBytes must be a positive bounded integer'],
  [{ graceMs: Number.POSITIVE_INFINITY }, 'graceMs must be a positive bounded integer'],
  [{ worktreePrefix: '..' }, 'worktreePrefix must start a valid Git branch name'],
  [{ worktreePrefix: 'bad name' }, 'worktreePrefix must start a valid Git branch name'],
  [{ worktreePrefix: '/' }, 'worktreePrefix must start a valid Git branch name'],
] as const)('rejects unusable local panel configuration %j', async (config, message) => {
  const context = new Context()
  try {
    expect(() => new ForgePanel(context, ForgePanel.Config(config))).toThrow(message)
  } finally { await context.fiber.dispose() }
})

it('refuses maintenance of an unloaded Session retaining a real checkout', async () => {
  const f = await fixture()
  const created = await f.ctx.worktrees.create(f.agent, { name: 'unloaded-checkout' })
  const id = SessionId('unloaded-panel')
  const session = Session.create(id, [], { ...f.agent.session.header, id })
  session.append('worktree/record', { action: 'request', from: null })
  session.append('worktree/record', { action: 'created', worktree: { ...created, from: null } })
  await expect(f.ctx.forgePanel.continueInProject(session, f.signal)).rejects.toThrow('Session is not loaded')
})

it('rejects direct reads once its owner is disposed', async () => {
  const f = await fixture()
  const controller = f.ctx.forgePanel
  await f.ctx.fiber.dispose()
  await expect(controller.localDiff(f.agent.session, { kind: 'uncommitted' }, f.signal)).rejects.toThrow('disposed')
})

it('creates the requested checkout for a cold pending Inbox before the first resumed step', async () => {
  const f = await fixture(false, true, false)
  f.agent.session.append('worktree/record', { action: 'request', from: null })
  f.agent.followup(message())
  const seed = f.agent.session.snapshotEvents()
  f.agent.cancel({ kind: 'user' })
  await f.agent.whenIdle()
  const logs = join(f.root, 'pending-logs')
  await f.ctx.plugin(JsonlPersistence, { root: logs, compression: 'none' })
  const writer = await f.ctx.sessionPersistence.create(f.agent.session.header)
  await writer.append(seed)
  await writer.close()
  const cold = await harness(f.root)
  try {
    const adapter = new MockAdapter([textResponse('resumed'), textResponse('notice')])
    cold.llm.registerAdapter(['mock'], adapter)
    await cold.plugin(ForgePanel)
    await cold.plugin(JsonlPersistence, { root: logs, compression: 'none' })
    const resumed = await cold.agents.resume({ resumeSessionId: f.agent.id, agentOptions: { provider: 'mock', model: 'mock' } })
    resumed.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue the pending checkout task.' }] }))
    await resumed.agent.whenIdle()
    expect(adapter.requests.length).toBeGreaterThan(0)
    const directory = cold.workingDirectory.get(resumed.agent.session)
    expect(directory).not.toBe(f.root)
    expect(JSON.stringify(adapter.requests[0]?.messages)).toContain(directory)
    expect(resumed.agent.session.snapshotEvents().some(event => event.type === 'worktree/record' && event.data.action === 'created')).toBe(true)
    expect(resumed.agent.session.header.cwd).toBe(f.root)
    await resumed.dispose()
  } finally { await cold.fiber.dispose() }
})

import { agentEvents } from '@deepseek-ai/dsh-agent'

it.each(['enter', 'reject', 'empty', 'consumed'] as const)('creates for an unheld first-step proposal with a %s decision', async (decision) => {
  const f = await fixture()
  f.ctx.forgePanel.requestWorktree(f.agent.session, null, f.signal)
  if (decision === 'consumed') f.ctx.on('agent/pre-step', async ({ agent }, next) => {
    for (const notice of agent.inbox.nextStep) if (notice.source.kind === 'working-directory') agent.inbox.remove(notice.id)
    return await next()
  })
  const proposed = decision === 'empty' ? [] : [message()]
  const result = await agentEvents(f.ctx, f.agent).waterfall('agent/pre-step', {
    modelSelection: { provider: 'mock', model: 'mock' }, turn: 1, step: 1, messages: proposed, signal: f.signal,
  }, () => Promise.resolve(decision === 'reject'
    ? { kind: 'reject' as const }
    : { kind: 'enter' as const, messages: proposed }))
  expect(f.ctx.workingDirectory.get(f.agent.session)).not.toBe(f.root)
  expect(f.agent.session.header.cwd).toBe(f.root)
  if (result.kind === 'enter') {
    expect(result.messages.length).toBe(decision === 'empty' ? 0 : decision === 'consumed' ? 1 : 2)
    if (decision === 'enter') expect(result.messages.at(-1)?.source.kind).toBe('working-directory')
  } else expect(result).toEqual({ kind: 'reject' })
})

it('publishes a committed execution-directory change to an already-following panel', async () => {
  const f = await fixture()
  const control = new AbortController()
  const stream = f.ctx.forgePanel.follow(f.agent.session, control.signal)[Symbol.asyncIterator]()
  for (;;) {
    const frame = await stream.next()
    if (frame.done) throw new Error('Panel ended before initial inspection')
    if (frame.value.checkout.state === 'ready') break
  }
  const child = join(f.root, 'selected')
  await mkdir(child)
  const next = stream.next()
  await f.ctx.workingDirectory.set(f.agent, child)
  control.abort()
  const frame = await next
  expect(frame.done).toBe(false)
  if (frame.done) throw new Error('Committed directory change was not published')
  expect(frame.value.directory).toBe(child)
  await stream.return?.(undefined)
})

async function followedReady(context: Context, session: Session, signal: AbortSignal) {
  const stream = context.forgePanel.follow(session, signal)[Symbol.asyncIterator]()
  for (;;) {
    const frame = await stream.next()
    if (frame.done) throw new Error('Panel ended before checkout inspection')
    if (frame.value.checkout.state === 'failed') throw new Error(frame.value.checkout.message)
    if (frame.value.checkout.state === 'ready') return stream
  }
}

it('drains both live panel followers before releasing its service dependencies', async () => {
  const f = await fixture()
  const first = await followedReady(f.ctx, f.agent.session, f.signal)
  const second = await followedReady(f.ctx, f.agent.session, f.signal)
  const firstEnd = first.next()
  const secondEnd = second.next()
  await f.ctx.fiber.dispose()
  expect((await firstEnd).done).toBe(true)
  expect((await secondEnd).done).toBe(true)
})

import { WorktreeCreations, messageOf } from '../src/worktree.ts'
import { SessionPanel, missingWorktree } from '../src/panel.ts'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
const PANEL_CONFIG = { gitCommand: 'git', gitTimeoutMs: 10_000, graceMs: 1_000, maxOutputBytes: 65_536, maxDiffBytes: 65_536, maxUntrackedFiles: 10 }
it('keeps a released panel closed despite late observations and cancels its waiting creation owner', async () => {
  const f = await fixture(false, true, false)
  const states = await f.ctx.sessionProjections.register(forgeWorktreeProjection)
  const changes: Session[] = []
  const creations = new WorktreeCreations(f.ctx, states, 'local-', (session) => { changes.push(session) })
  let idle = 0
  setSandboxMode(f.agent.session, 'read-only')
  const panel = new SessionPanel(f.ctx, PANEL_CONFIG, f.agent.session, states, creations, () => { idle++ })
  const control = new AbortController()
  const stream = panel.follow(control.signal)[Symbol.asyncIterator]()
  const first = await stream.next()
  if (first.done) throw new Error('Panel ended before its initial state')
  expect(first.value.worktree.blocker).toBe('read-only')
  const ending = stream.next()
  await panel.dispose()
  await ending
  control.abort()
  await stream.return?.(undefined)
  expect(idle).toBe(1)
  panel.restored()
  panel.reinspect()
  panel.updateWorktree()
  const after = panel.follow(f.signal)[Symbol.asyncIterator]()
  expect((await after.next()).done).toBe(true)
  await creations.dispose()
  creations.holdCreation(f.agent)
  expect(changes).toEqual([])
  expect(messageOf('external failure')).toBe('external failure')
})

it('detects an unrelated replacement checkout and retains unknown branch availability during interrupted restoration', async () => {
  const f = await fixture(false, true, false)
  const states = await f.ctx.sessionProjections.register(forgeWorktreeProjection)
  const created = await f.ctx.worktrees.create(f.agent, { name: 'identity-check' })
  f.agent.session.append('worktree/record', { action: 'request', from: null })
  f.agent.session.append('worktree/record', { action: 'created', worktree: { ...created, from: null } })
  const check = () => missingWorktree(f.ctx, PANEL_CONFIG, f.agent.session, states.stateOf(f.agent.session), created.path, f.signal)
  expect(await check()).toBeNull()
  await rm(created.path, { recursive: true })
  await mkdir(created.path)
  await git(created.path, 'init', '-b', 'unrelated')
  expect(await check()).toEqual({ branchExists: true })
  await rm(join(created.path, '.git'), { recursive: true })
  expect(await check()).toEqual({ branchExists: true })
  await rm(join(f.root, '.git'), { recursive: true })
  await expect(check()).rejects.toThrow()
  f.agent.session.append('worktree/record', { action: 'restoring' })
  expect(await check()).toEqual({ branchExists: null })
})

it.each(['success', 'failure', 'disposed'] as const)('discards a real in-flight Git inspection after %s supersession', async (outcome) => {
  const f = await fixture(false, true, false)
  const command = join(f.root, 'inspection-wrapper')
  const quoted = `'${f.root.replaceAll("'", "'\\''")}'`
  await writeFile(command, `#!/bin/sh
probe_root=${quoted}
case "$*" in
  *"show-toplevel"*)
    if ! test -f "$probe_root/inspection-released"; then
      printf started > "$probe_root/inspection-started"
      while ! test -f "$probe_root/inspection-released"; do /bin/sleep 0.01; done
      if test -f "$probe_root/fail-stale"; then printf 'fatal: stale fixture read refused\n' >&2; exit 128; fi
    fi;;
esac
exec git "$@"
`)
  await chmod(command, 0o700)
  if (outcome === 'failure') await writeFile(join(f.root, 'fail-stale'), '')
  await f.ctx.plugin(ForgePanel, { gitCommand: command })
  const started = Promise.withResolvers<undefined>()
  const watcher = watch(f.root, (_event, filename) => { if (filename === 'inspection-started') started.resolve(undefined) })
  watchers.push(watcher)
  const control = new AbortController()
  const stream = f.ctx.forgePanel.follow(f.agent.session, control.signal)[Symbol.asyncIterator]()
  try {
    const first = await stream.next()
    if (first.done) throw new Error('Panel ended before inspection started')
    expect(first.value.checkout.state).toBe('pending')
    await started.promise
    if (outcome === 'disposed') {
      const ended = stream.next()
      await f.ctx.fiber.dispose()
      expect((await ended).done).toBe(true)
      return
    }
    const child = join(f.root, 'next-directory')
    await mkdir(child)
    await f.ctx.workingDirectory.set(f.agent, child)
    await writeFile(join(f.root, 'inspection-released'), '')
    for (;;) {
      const frame = await stream.next()
      if (frame.done) throw new Error('Panel ended before the new directory was inspected')
      expect(frame.value.directory).toBe(child)
      expect(frame.value.checkout.state).not.toBe('failed')
      if (frame.value.checkout.state === 'ready') break
    }
  } finally {
    control.abort()
    await stream.return?.(undefined)
  }
})

it('withdraws after delivery but before held creation enters Git', async () => {
  const f = await fixture()
  f.ctx.forgePanel.requestWorktree(f.agent.session, null, f.signal)
  f.agent.followup(message())
  f.ctx.forgePanel.cancelWorktree(f.agent.session, f.signal)
  await f.agent.whenIdle()
  expect(f.ctx.workingDirectory.get(f.agent.session)).toBe(f.root)
  expect(f.agent.session.snapshotEvents().some(event => event.type === 'worktree/record' && event.data.action === 'created')).toBe(false)
})

it('returns an originless Session to its recorded checkout repository', async () => {
  const f = await fixture()
  const agent = await f.ctx.agentLoop.create(SessionId('originless'), { provider: 'mock', model: 'mock' }, {})
  await f.ctx.workingDirectory.set(agent, f.root)
  f.ctx.forgePanel.requestWorktree(agent.session, null, f.signal)
  agent.followup(message())
  await agent.whenIdle()
  expect(f.ctx.workingDirectory.get(agent.session)).not.toBe(f.root)
  await f.ctx.forgePanel.continueInProject(agent.session, f.signal)
  expect(f.ctx.workingDirectory.get(agent.session)).toBe(f.root)
  expect(agent.session.header.cwd).toBeUndefined()
})

it('rejects restoration when a retained local checkout has no provider', async () => {
  const f = await fixture(false, false)
  const path = join(f.root, 'retained')
  await git(f.root, 'worktree', 'add', '-b', 'retained', path)
  f.agent.session.append(WORKTREE_RECORD, { action: 'request', from: null })
  f.agent.session.append(WORKTREE_RECORD, { action: 'created', worktree: {
    path, branch: 'retained', from: null, baseCommit: await git(f.root, 'rev-parse', 'HEAD'), repositoryRoot: f.root,
  } })
  await expect(f.ctx.forgePanel.restoreWorktree(f.agent.session, f.signal)).rejects.toThrow('No worktree service')
})

it('rejects a local comparison outside a checkout and preserves file read failures', async () => {
  const f = await fixture()
  await expect(f.ctx.forgePanel.localText(f.agent.session, { kind: 'uncommitted' }, 'missing.txt', f.signal)).rejects.toThrow()
  await f.ctx.workingDirectory.set(f.agent, join(f.root, '..'))
  await expect(f.ctx.forgePanel.localDiff(f.agent.session, { kind: 'uncommitted' }, f.signal)).rejects.toThrow('not inside a Git checkout')
})

it('maps bounded diff failures through the public controller', async () => {
  const f = await fixture(false, true, false)
  await f.ctx.plugin(ForgePanel, { maxDiffBytes: 128 })
  await writeFile(join(f.root, 'tracked.txt'), 'large change\n'.repeat(100))
  await expect(f.ctx.forgePanel.localDiff(f.agent.session, { kind: 'uncommitted' }, f.signal))
    .rejects.toMatchObject({ code: 'forgePanel/diff-too-large' })
})

it('maps incomplete filter configuration without starting a comparison', async () => {
  const f = await fixture(false, true, false)
  await f.ctx.plugin(ForgePanel, { maxDiffBytes: 128 })
  await git(f.root, 'config', `filter.${'long'.repeat(60)}.clean`, 'cat')
  await expect(f.ctx.forgePanel.localDiff(f.agent.session, { kind: 'unstaged' }, f.signal))
    .rejects.toMatchObject({ code: 'forgePanel/filter-config-failed' })
})

it('retains a replayed request without its provider and drains its wait on user cancellation', async () => {
  const f = await fixture(false, false)
  f.agent.session.append(WORKTREE_RECORD, { action: 'request', from: null })
  const failed = panelUntil(f.ctx, f.agent.session, state => state.worktree.failure !== null)
  f.agent.followup(message())
  expect((await failed).worktree.failure).toMatchObject({ branch: null, phase: 'prepare', message: 'No worktree service is mounted' })
  expect(f.adapter.requests).toHaveLength(0)
  f.agent.cancel({ kind: 'user' })
  await f.agent.whenIdle()
  expect(f.ctx.workingDirectory.get(f.agent.session)).toBe(f.root)
})

it('rejects control maintenance while another real checkout owns the Agent', async () => {
  const f = await fixture(true)
  await writeFile(join(f.root, 'checkout-release'), '')
  const created = await f.ctx.worktrees.create(f.agent, { name: 'retained' })
  await rm(join(f.root, 'checkout-release'))
  await rm(join(f.root, 'checkout-started'))
  await f.ctx.workingDirectory.set(f.agent, f.root)
  f.agent.session.append(WORKTREE_RECORD, { action: 'request', from: null })
  f.agent.session.append(WORKTREE_RECORD, { action: 'created', worktree: { ...created, from: null } })
  const started = Promise.withResolvers<undefined>()
  const watcher = watch(f.root, (_event, filename) => { if (filename === 'checkout-started') started.resolve(undefined) })
  watchers.push(watcher)
  const work = f.agent.runMaintenance(async (signal) => {
    await f.ctx.worktrees.create(f.agent, { name: 'maintenance' }, signal)
  })
  const outcome = work.catch((error: unknown) => error)
  await started.promise
  await expect(f.ctx.forgePanel.continueInProject(f.agent.session, f.signal)).rejects.toThrow('Session is busy')
  f.agent.followup(message())
  f.agent.cancel({ kind: 'user' })
  const failure = await outcome
  expect(failure instanceof Error ? failure.cause : failure).toEqual({ kind: 'user' })
  await f.agent.whenIdle()
})

it('publishes a live Git inspection failure and lets an unanswerable restoration check release admission', async () => {
  const f = await fixture(false, true, false)
  const created = await f.ctx.worktrees.create(f.agent, { name: 'inspection-failure' })
  f.agent.session.append(WORKTREE_RECORD, { action: 'request', from: null })
  f.agent.session.append(WORKTREE_RECORD, { action: 'created', worktree: { ...created, from: null } })
  await rm(created.path, { recursive: true })
  await f.ctx.plugin(ForgePanel, { gitCommand: join(f.root, 'absent-git-executable') })
  const failed = await panelUntil(f.ctx, f.agent.session, state => state.checkout.state === 'failed')
  expect(failed.checkout.state).toBe('failed')
  f.agent.followup(message())
  await f.agent.whenIdle()
  expect(f.adapter.requests.length).toBeGreaterThan(0)
  expect(f.ctx.workingDirectory.get(f.agent.session)).toBe(f.root)
})

it('leaves a pending request alone when real maintenance already owns the Agent', async () => {
  const f = await fixture(true)
  f.ctx.forgePanel.requestWorktree(f.agent.session, null, f.signal)
  const started = Promise.withResolvers<undefined>()
  const watcher = watch(f.root, (_event, filename) => { if (filename === 'checkout-started') started.resolve(undefined) })
  watchers.push(watcher)
  const work = f.agent.runMaintenance(async (signal) => {
    await f.ctx.worktrees.create(f.agent, { name: 'occupied' }, signal)
  })
  const outcome = work.catch((error: unknown) => error)
  await started.promise
  f.agent.followup(message())
  f.agent.cancel({ kind: 'user' })
  const failure = await outcome
  expect(failure instanceof Error ? failure.cause : failure).toEqual({ kind: 'user' })
  await f.agent.whenIdle()
  expect(f.agent.session.snapshotEvents().some(event => event.type === 'worktree/record' && event.data.action === 'created')).toBe(false)
})

it('keeps a replacement request waiting until the user retries it', async () => {
  const f = await fixture()
  f.ctx.forgePanel.requestWorktree(f.agent.session, 'missing-base', f.signal)
  const failed = panelUntil(f.ctx, f.agent.session, state => state.worktree.failure !== null)
  f.agent.followup(message())
  await failed
  f.ctx.forgePanel.requestWorktree(f.agent.session, 'main', f.signal)
  const refreshed = await panelUntil(f.ctx, f.agent.session, state => state.worktree.request?.from === 'main')
  expect(refreshed.worktree.created).toBeNull()
  // The recheck is delivered before retry, so it cannot consume the user's retry decision.
  await Promise.resolve()
  f.ctx.forgePanel.retryWorktree(f.agent.session, f.signal)
  await f.agent.whenIdle()
  expect(f.ctx.workingDirectory.get(f.agent.session)).not.toBe(f.root)
})

it('discards a missing-checkout answer after the Session has returned to its original project', async () => {
  const f = await fixture(false, true, false)
  const created = await f.ctx.worktrees.create(f.agent, { name: 'missing-race' })
  f.agent.session.append(WORKTREE_RECORD, { action: 'request', from: null })
  f.agent.session.append(WORKTREE_RECORD, { action: 'created', worktree: { ...created, from: null } })
  await rm(created.path, { recursive: true })
  const command = join(f.root, 'branch-inspection')
  await writeFile(command, `#!/bin/sh
case "$*" in
  *"show-ref"*) printf started > "${f.root}/branch-started"; while ! test -f "${f.root}/branch-release"; do /bin/sleep 0.01; done;;
esac
exec git "$@"
`)
  await chmod(command, 0o700)
  await f.ctx.plugin(ForgePanel, { gitCommand: command })
  const started = Promise.withResolvers<undefined>()
  const watcher = watch(f.root, (_event, filename) => { if (filename === 'branch-started') started.resolve(undefined) })
  watchers.push(watcher)
  f.agent.followup(message())
  await started.promise
  await f.ctx.workingDirectory.set(f.agent, f.root)
  await writeFile(join(f.root, 'branch-release'), '')
  await f.agent.whenIdle()
  expect(f.ctx.workingDirectory.get(f.agent.session)).toBe(f.root)
  expect(f.adapter.requests.length).toBeGreaterThan(0)
  expect(f.agent.session.snapshotEvents().some(event => event.type === 'worktree/record' && event.data.action === 'restoring')).toBe(false)
})

it('does not publish a completed Git answer after teardown begins while its process drains', async () => {
  const f = await fixture(false, true, false)
  await f.ctx.workingDirectory.set(f.agent, join(f.root, '..'))
  const states = await f.ctx.sessionProjections.register(forgeWorktreeProjection)
  const changes: Session[] = []
  const creations = new WorktreeCreations(f.ctx, states, 'local-', (session) => { changes.push(session) })
  let disposal: Promise<void> | undefined
  const spawn = f.ctx.subprocess.spawn.bind(f.ctx.subprocess)
  vi.spyOn(f.ctx.subprocess, 'spawn').mockImplementation((spec) => {
    const child = spawn(spec)
    const drain = child.waitForExit.bind(child)
    vi.spyOn(child, 'waitForExit').mockImplementation(async () => {
      const outcome = await drain()
      disposal ??= panel.dispose()
      return outcome
    })
    return child
  })
  let idle = 0
  const panel = new SessionPanel(f.ctx, PANEL_CONFIG, f.agent.session, states, creations, () => { idle++ })
  const stream = panel.follow(f.signal)[Symbol.asyncIterator]()
  const first = await stream.next()
  if (first.done) throw new Error('Panel ended before inspection')
  expect(first.value.checkout.state).toBe('pending')
  expect((await stream.next()).done).toBe(true)
  await disposal
  expect(idle).toBe(1)
  expect(changes).toHaveLength(0)
  await creations.dispose()
})
