// Durable-root support for the web scaffold (B1.5 Host scaffold support,
// .plans/octopus-implementation/stage-b0/persistence-and-host-tests.md R5).
// The real shipped Web/Host composition with real JSONL session persistence
// and real storage-json, no model calls and no browser: sessions are created
// through the public agent registry, durable state is written through public
// shipped consumers, and relaunches ride the same seams the product does.
// Feature-specific B1 questions are out of scope here: session-decisions is
// not part of this composition, so no decision record is claimed or asserted.
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import { launchWebScaffold, readPersistedEvents, type WebScaffold } from './scaffold.ts'

/** Caller-owned durable roots with one sentinel file each, under one owned parent. */
async function durableWorld(): Promise<{
  home: string
  roots: { persistenceRoot: string; storageRoot: string; workspaceCwd: string }
}> {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'dsh-web-durable-')))
  const roots = {
    workspaceCwd: join(home, 'workspace'),
    persistenceRoot: join(home, 'sessions'),
    storageRoot: join(home, 'storage'),
  }
  await Promise.all(Object.values(roots).map(dir => mkdir(dir, { recursive: true })))
  await Promise.all(Object.entries(roots).map(([name, dir]) => writeFile(join(dir, `${name}.sentinel`), 'keep')))
  return { home, roots }
}

/**
 * One durable user message appended through the live session, flushed before
 * returning. A generic persistence probe through public Session APIs — not a
 * B1 prompt-admission path; the feature's controller/rpcId admission test
 * stays mandatory in B1.5.
 */
async function saveRealSession(scaffold: WebScaffold, sessionId: string, text: string): Promise<void> {
  const handle = await scaffold.ctx.agents.create({
    sessionId: SessionId(sessionId),
    // The Host's session.create path pins the project cwd in the header
    // through this same public option.
    meta: { cwd: scaffold.workspaceCwd },
    setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx).then(() => undefined),
  })
  try {
    handle.agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await scaffold.ctx.sessions.flush(handle.agent.session)
  } finally {
    await handle.dispose()
  }
}

/** The persisted user prompt texts of one stored session, through the real JSONL backend. */
async function persistedPrompts(scaffold: WebScaffold, id: string): Promise<string[]> {
  return (await readPersistedEvents(scaffold, SessionId(id))).flatMap((event) => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') return []
    return [event.data.content.filter(block => block.type === 'text').map(block => block.text).join('')]
  })
}

it('keeps caller-owned durable roots across close and relaunch', async () => {
  const { home, roots } = await durableWorld()
  try {
    const first = await launchWebScaffold({ durableRoots: roots })
    let workspaceId: string | undefined
    try {
      await saveRealSession(first, 'durable-relaunch', 'durable prompt')
      // A durable workspace record is the shipped storage consumer: its
      // record must survive through the exact caller storageRoot.
      await mkdir(join(roots.workspaceCwd, 'project'), { recursive: true })
      workspaceId = (await first.ctx.workspaceRegistry.create(
        join(roots.workspaceCwd, 'project'), 'Durable Probe',
      )).id
    } finally {
      await first.close()
    }
    // Close removed nothing caller-owned, and storage did not silently join
    // the workspace default.
    for (const [name, dir] of Object.entries(roots)) {
      expect(existsSync(join(dir, `${name}.sentinel`)), `${name} sentinel`).toBe(true)
    }
    expect(existsSync(join(roots.workspaceCwd, '.dsh-storages'))).toBe(false)

    const second = await launchWebScaffold({ durableRoots: roots })
    try {
      const metas = await second.ctx.sessionPersistence.list()
      const restored = metas.find(meta => meta.header.id === SessionId('durable-relaunch'))
      expect(restored?.header.cwd, 'restored Session header cwd stays valid').toBe(roots.workspaceCwd)
      expect(await persistedPrompts(second, 'durable-relaunch')).toEqual(['durable prompt'])
      const workspaces = second.ctx.workspaceRegistry.list()
      const workspace = workspaces.find(entry => entry.id === workspaceId)
      expect(workspace?.path, 'durable workspace record survives through storageRoot')
        .toBe(join(roots.workspaceCwd, 'project'))
      expect(workspace?.title).toBe('Durable Probe')
    } finally {
      await second.close()
    }
    for (const [name, dir] of Object.entries(roots)) {
      expect(existsSync(join(dir, `${name}.sentinel`)), `${name} sentinel after relaunch`).toBe(true)
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('still removes its default-owned temp roots at close', async () => {
  const scaffold = await launchWebScaffold()
  const { workspaceCwd, persistenceRoot } = scaffold
  expect(existsSync(workspaceCwd)).toBe(true)
  expect(existsSync(persistenceRoot)).toBe(true)
  await scaffold.close()
  expect(existsSync(workspaceCwd), 'default workspace root removed').toBe(false)
  expect(existsSync(persistenceRoot), 'default persistence root removed').toBe(false)
})

it('leaves caller-owned roots untouched when boot fails', async () => {
  const { home, roots } = await durableWorld()
  try {
    // A profile package directory with no manifest fails the boot inside the
    // settled-launch try block, exercising the failed-setup cleanup path.
    await expect(launchWebScaffold({
      durableRoots: roots,
      profile: { packages: [{ dir: join(home, 'missing-package') }] },
    })).rejects.toThrow()
    for (const [name, dir] of Object.entries(roots)) {
      expect(existsSync(dir), `${name} root survives failed boot`).toBe(true)
      expect(existsSync(join(dir, `${name}.sentinel`)), `${name} sentinel survives failed boot`).toBe(true)
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it('restores a flushed pending inbox from a checkpoint copy predating graceful disposal', async () => {
  const { home, roots } = await durableWorld()
  const checkpoint = {
    persistenceRoot: join(home, 'checkpoint-sessions'),
    storageRoot: join(home, 'checkpoint-storage'),
  }
  try {
    const first = await launchWebScaffold({ durableRoots: roots })
    const queued = createUserMessage({
      content: [{ type: 'text', text: 'queued before crash' }],
      source: { kind: 'user' },
    })
    const handle = await first.ctx.agents.create({
      sessionId: SessionId('durable-crash-checkpoint'),
      meta: { cwd: roots.workspaceCwd },
      setup: agentCtx => first.ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
    try {
      // Generic pending-queue probe through the driver-owned durable inbox
      // (not a B1 prompt-admission/dedup path): pending input recorded as a
      // durable splice, then flushed past the persistence barrier.
      handle.agent.inbox.append('next-turn', queued)
      await first.ctx.sessions.flush(handle.agent.session)
      // Crash-style checkpoint: copy while the entry is still pending and the
      // agent is live, before any disposal can durably clear it. The
      // workspaceCwd is not copied — the caller-owned original stays valid
      // and is reused. Copying after disposal would capture the cleared
      // queue, so this ordering is part of the proof.
      await cp(roots.persistenceRoot, checkpoint.persistenceRoot, { recursive: true })
      await cp(roots.storageRoot, checkpoint.storageRoot, { recursive: true })
    } finally {
      await handle.dispose()
      await first.close()
    }
    const second = await launchWebScaffold({
      durableRoots: { ...roots, ...checkpoint },
    })
    try {
      const resumed = await second.ctx.agents.resume({
        resumeSessionId: SessionId('durable-crash-checkpoint'),
        setup: agentCtx => second.ctx.agentPresets.mount(agentCtx).then(() => undefined),
      })
      try {
        expect(resumed.agent.inbox.nextTurn.map(message => message.id)).toEqual([queued.id])
        expect(resumed.agent.inbox.nextTurn[0]?.content).toEqual(queued.content)
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

it('serves the shipped search-disabled composition under sessionSearch never', async () => {
  const scaffold = await launchWebScaffold({ sessionSearch: 'never' })
  try {
    await expect(scaffold.ctx.sessionQuery.searchEvents({
      sessionId: SessionId('search-disabled'),
      query: 'anything',
    })).rejects.toMatchObject({ code: 'SESSION_QUERY_SEARCH_DISABLED' })
  } finally {
    await scaffold.close()
  }
})
