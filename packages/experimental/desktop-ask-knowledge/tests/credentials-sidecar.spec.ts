/** Credentials bridge injects DEEPSEEK_API_KEY only into the sidecar child. */

import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'
import { MISSING_API_KEY_MESSAGE, resolveProposeEnv } from '../src/credentials-bridge.ts'
import { runSidecar } from '../src/sidecar.ts'
import { installFakeSidecar } from './helpers/install-sidecar.ts'

const KEY = credentialRef('DEEPSEEK_API_KEY')
const FIRST = 'sk-ask-knowledge-first-9f3c2a1b7d4e8c0f6a5b4c3d2e1f0a9b'
const SECOND = 'sk-ask-knowledge-second-0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function bootCredentials(dir: string): Promise<Context> {
  const ctx = new Context()
  const fiber = ctx.plugin(LocalCredentialProvider, {
    path: join(dir, '.credentials.yaml'),
    watch: false,
  })
  cleanups.push(() => fiber.dispose())
  await fiber
  return ctx
}

describe('ask-knowledge credentials sidecar', () => {
  it('injects the file-store key after deleting process.env and rotates the hash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ask-knowledge-cred-'))
    const sidecarHome = join(dir, 'sidecar')
    await installFakeSidecar(sidecarHome)
    const previous = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    cleanups.push(() => {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = previous
    })
    const ctx = await bootCredentials(dir)
    await ctx.credentials.set(KEY, FIRST)
    const env = await resolveProposeEnv(ctx)
    expect(env.DEEPSEEK_API_KEY).toBe(FIRST)
    const first = await runSidecar({ sidecarRuntimePath: sidecarHome }, { command: 'self-test' }, {
      env: { ...env, ASK_KNOWLEDGE_SIDECAR_KEY_HASH: '1' },
    })
    expect(first.hasDeepseekKey).toBe(true)
    expect(first.keyHash).toBe(createHash('sha256').update(FIRST).digest('hex'))
    await ctx.credentials.set(KEY, SECOND)
    const rotated = await runSidecar({ sidecarRuntimePath: sidecarHome }, { command: 'self-test' }, {
      env: { ...(await resolveProposeEnv(ctx)), ASK_KNOWLEDGE_SIDECAR_KEY_HASH: '1' },
    })
    expect(rotated.keyHash).toBe(createHash('sha256').update(SECOND).digest('hex'))
    expect(rotated.keyHash).not.toBe(first.keyHash)
    const dumped = JSON.stringify({ first, rotated })
    expect(dumped).not.toContain(FIRST)
    expect(dumped).not.toContain(SECOND)
    expect(process.env.DEEPSEEK_API_KEY).toBeUndefined()
  })

  it('fails before spawn when the Models page has no key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ask-knowledge-nokey-'))
    const previous = process.env.DEEPSEEK_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    cleanups.push(() => {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = previous
    })
    const ctx = await bootCredentials(dir)
    await expect(resolveProposeEnv(ctx)).rejects.toMatchObject({
      code: 'credentials-missing',
      message: MISSING_API_KEY_MESSAGE,
    })
    await expect(resolveProposeEnv(new Context())).rejects.toBeInstanceOf(AskKnowledgeError)
    const blank = new Context()
    blank.provide('credentials', { resolve: async () => ({ value: '   ' }) })
    await expect(resolveProposeEnv(blank)).rejects.toMatchObject({
      code: 'credentials-missing',
      message: MISSING_API_KEY_MESSAGE,
    })
    expect(MISSING_API_KEY_MESSAGE).toBe('还没有 API Key')
  })
})
