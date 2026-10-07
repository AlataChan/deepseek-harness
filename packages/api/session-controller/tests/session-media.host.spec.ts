/** session media remotes: unavailable, duck-typed overlay, aborted, failed. */

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { createSessionTestRemote } from './test-remote.ts'
import { isMediaFailure, mapMediaError, type DesktopMediaSeam } from '../src/session-media.ts'
import type { SessionMediaWork as WireWork } from '../src/types.ts'

class MediaError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'MediaError'
  }
}

const sampleWork: WireWork = {
  artifactId: 'a_1',
  requestId: 'r_1',
  kind: 'video',
  name: '样片.mp4',
  sessionId: 's-1',
  createdAt: '2026-09-20T00:00:00.000Z',
}

function stubAgent(session: Session): Agent {
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

async function harness(options: { media?: DesktopMediaSeam } = {}) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-media-session-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  const factory: AgentFactory = {
    async createAgent(_ownerCtx, create) {
      const session = ctx.sessions.prepare(
        create.sessionId,
        create.meta === undefined ? {} : { meta: create.meta },
      )
      const detach = ctx.sessions.enter(session)
      ctx.sessions.announce(session)
      const agent = stubAgent(session)
      const unregister = ctx.agents.register(agent)
      return {
        agent,
        dispose: () => {
          unregister()
          detach()
          return Promise.resolve()
        },
      }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  ctx.provide('workspaceRegistry', { get: () => undefined } as never)
  if (options.media !== undefined) ctx.provide('desktopMedia', options.media)
  const remote = createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd,
  })
  return { remote, ctx }
}

function mediaStub(overrides: Partial<DesktopMediaSeam> = {}): DesktopMediaSeam {
  return {
    listWorks: () => Promise.resolve([sampleWork]),
    listVoices: () => Promise.resolve([{ voiceId: 'male-qn-qingse', label: '青涩男声', system: true }]),
    runtimeStatus: () => Promise.resolve({ ready: true, guidance: '' }),
    openWork: () => Promise.resolve({ requested: true, message: 'Requested the system to open the file.' }),
    revealWork: () => Promise.resolve({ requested: true, message: 'Requested the system to open the file.' }),
    copyWorkPath: () => Promise.resolve({ path: '/tmp/work.mp4' }),
    importBytes: () => Promise.resolve(sampleWork),
    saveWorkAs: () => Promise.resolve({ path: '/tmp/saved.mp4' }),
    ...overrides,
  }
}

describe('session media remotes', () => {
  it('fails without the overlay', async () => {
    const { remote } = await harness()
    await expect(remote.listMediaWorks({})).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/media-unavailable' },
    })
  })

  it('lists works, voices, and runtime without activating an agent', async () => {
    const { remote, ctx } = await harness({ media: mediaStub() })
    await expect(remote.listMediaWorks({ sessionId: 's-1' })).resolves.toMatchObject({
      ok: true,
      value: [sampleWork],
    })
    await expect(remote.listMediaWorks({ workspaceId: 'w-1' })).resolves.toMatchObject({
      ok: true,
      value: [sampleWork],
    })
    await expect(remote.listMediaWorks({ workspaceId: 'w-1', sessionId: 's-1' })).resolves.toMatchObject({
      ok: true,
      value: [sampleWork],
    })
    await expect(remote.listMediaVoices()).resolves.toMatchObject({
      ok: true,
      value: [{ voiceId: 'male-qn-qingse', system: true }],
    })
    await expect(remote.mediaRuntimeStatus()).resolves.toMatchObject({
      ok: true,
      value: { ready: true },
    })
    expect(ctx.agents.get(SessionId('s-1'))).toBeUndefined()
  })

  it('opens, reveals, copies, imports, and saves', async () => {
    const { remote } = await harness({ media: mediaStub() })
    await expect(remote.openMediaWork({ artifactId: 'a_1' })).resolves.toMatchObject({
      ok: true,
      value: { requested: true },
    })
    await expect(remote.revealMediaWork({ artifactId: 'a_1' })).resolves.toMatchObject({
      ok: true,
      value: { requested: true },
    })
    await expect(remote.copyMediaWorkPath({ artifactId: 'a_1' })).resolves.toMatchObject({
      ok: true,
      value: { path: '/tmp/work.mp4' },
    })
    await expect(remote.importMediaBytes({
      filename: 'clip.mp4',
      bytes: 'aGk=',
      sessionId: SessionId('s-1'),
    })).resolves.toMatchObject({ ok: true, value: sampleWork })
    await expect(remote.saveMediaWorkAs({
      artifactId: 'a_1',
      directory: '/tmp',
      filename: 'out.mp4',
    })).resolves.toMatchObject({ ok: true, value: { path: '/tmp/saved.mp4' } })
  })

  it('rejects non-canonical import bytes and maps MediaError', async () => {
    const { remote } = await harness({
      media: mediaStub({
        openWork: () => Promise.reject(new MediaError('artifact-missing', 'gone')),
      }),
    })
    await expect(remote.importMediaBytes({
      filename: 'a.mp4',
      bytes: 'aGk',
      sessionId: SessionId('s-1'),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/bad-request' },
    })
    await expect(remote.openMediaWork({ artifactId: 'missing' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/media-failed' },
    })
  })

  it('maps abort, MediaError, RemoteError, and unknown failures', () => {
    const live = new AbortController().signal
    const aborted = AbortSignal.abort()
    expect(isMediaFailure(new MediaError('runtime-missing', 'install'))).toBe(true)
    expect(isMediaFailure(new Error('nope'))).toBe(false)
    expect(isMediaFailure({ name: 'MediaError', code: 1, message: 'x' })).toBe(false)
    expect(isMediaFailure({ name: 'MediaError', code: 'x' })).toBe(false)
    expect(isMediaFailure(null)).toBe(false)
    expect(() => mapMediaError(new Error('boom'), aborted)).toThrow(RemoteError)
    expect(() => mapMediaError(new MediaError('runtime-missing', 'install'), live)).toThrow(RemoteError)
    expect(() => mapMediaError(new RemoteError('gateway/internal', 'keep', {}), live)).toThrow(RemoteError)
    expect(() => mapMediaError('string', live)).toThrow(RemoteError)
  })

  it('fails closed when the caller aborts before each remote', async () => {
    const { remote } = await harness({ media: mediaStub() })
    const signal = AbortSignal.abort()
    await expect(remote.listMediaWorks({}, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/cancelled' },
    })
    await expect(remote.listMediaVoices(signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/cancelled' },
    })
    await expect(remote.mediaRuntimeStatus(signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/cancelled' },
    })
    await expect(remote.openMediaWork({ artifactId: 'a_1' }, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/cancelled' },
    })
    await expect(remote.revealMediaWork({ artifactId: 'a_1' }, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/cancelled' },
    })
    await expect(remote.importMediaBytes({
      filename: 'a.mp4',
      bytes: 'aGk=',
      sessionId: SessionId('s-1'),
    }, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/cancelled' },
    })
    await expect(remote.saveMediaWorkAs({
      artifactId: 'a_1',
      directory: '/tmp',
      filename: 'out.mp4',
    }, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/cancelled' },
    })
  })

  it('maps overlay failures on voices, runtime, reveal, copy, import, and save', async () => {
    const { remote } = await harness({
      media: mediaStub({
        listVoices: () => Promise.reject(new MediaError('voice-unavailable', 'gone')),
        runtimeStatus: () => Promise.reject(new Error('boom')),
        revealWork: () => Promise.reject(new RemoteError('gateway/internal', 'keep', {})),
        copyWorkPath: () => Promise.reject('string'),
        importBytes: () => Promise.reject(new MediaError('import-rejected', 'bad')),
        saveWorkAs: () => Promise.reject(new MediaError('path-not-absolute', 'rel')),
      }),
    })
    await expect(remote.listMediaVoices()).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/media-failed' },
    })
    await expect(remote.mediaRuntimeStatus()).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/internal' },
    })
    await expect(remote.revealMediaWork({ artifactId: 'a_1' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/internal' },
    })
    await expect(remote.copyMediaWorkPath({ artifactId: 'a_1' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/internal' },
    })
    await expect(remote.importMediaBytes({
      filename: 'a.mp4',
      bytes: 'aGk=',
      sessionId: SessionId('s-1'),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/media-failed' },
    })
    await expect(remote.saveMediaWorkAs({
      artifactId: 'a_1',
      directory: '/tmp',
      filename: 'out.mp4',
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/media-failed' },
    })
  })
})
