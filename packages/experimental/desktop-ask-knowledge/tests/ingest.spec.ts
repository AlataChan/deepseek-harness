/** Ingest barrier, reuseRawPath, apply-failure re-propose, and upload caps. */

import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import type { AskKnowledge } from '@deepseek-ai/dsh-host-ask-knowledge'
import DesktopAskKnowledge from '../src/index.ts'
import { withLibraryLock } from '../src/library-lock.ts'
import { decodeIngestChunk, MAX_INGEST_CHUNK_BYTES } from '../src/upload-temp.ts'
import { installFakeSidecar, writeFakeSidecarEnv } from './helpers/install-sidecar.ts'

const KEY = credentialRef('DEEPSEEK_API_KEY')
const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function boot(options: {
  sidecarEnv?: NodeJS.ProcessEnv
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ask-knowledge-ingest-'))
  const sidecarHome = join(root, 'sidecar')
  await installFakeSidecar(sidecarHome)
  if (options.sidecarEnv !== undefined) {
    const overlay: Record<string, string> = {}
    for (const [key, value] of Object.entries(options.sidecarEnv)) {
      if (value !== undefined) overlay[key] = value
    }
    await writeFakeSidecarEnv(sidecarHome, overlay)
  }
  const previousKey = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  cleanups.push(() => {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previousKey
  })
  const ctx = new Context()
  ctx.provide('systemPrompt', { section: () => () => {} })
  ctx.provide('sessionProjections', { register: () => () => {}, stateOf: () => null })
  const creds = ctx.plugin(LocalCredentialProvider, {
    path: join(root, '.credentials.yaml'),
    watch: false,
  })
  await creds
  cleanups.push(() => creds.dispose())
  await ctx.credentials.set(KEY, 'sk-test-ingest-not-a-real-key')
  const fiber = ctx.plugin(DesktopAskKnowledge, {
    knowledgeHome: root,
    sidecarRuntimePath: sidecarHome,
  })
  await fiber.await()
  cleanups.push(() => fiber.dispose())
  return { ctx, root, sidecarHome, capability: ctx.askKnowledge }
}

async function ingestText(
  capability: AskKnowledge,
  libraryId: Parameters<AskKnowledge['beginIngest']>[0]['libraryId'],
  filename: string,
  body: string,
  reuseRawPath?: string,
) {
  const handle = await capability.beginIngest({ libraryId, filename })
  const bytes = Buffer.from(body, 'utf8').toString('base64')
  await capability.appendIngestChunk({ handle, bytes })
  return capability.finishIngest({
    handle,
    ...reuseRawPath === undefined ? {} : { reuseRawPath },
  })
}

describe('ask-knowledge ingest', () => {
  it('applies a markdown fixture through begin/append/finish', async () => {
    const { capability } = await boot()
    const library = await capability.createLibrary({ displayName: '制度' })
    const result = await ingestText(capability, library.id, '报销.md', '# 报销\n\n流程\n')
    expect(result).toMatchObject({ status: 'applied', rawRelPath: 'raw/报销.md' })
  })

  it('serializes two overlapping finishIngest calls on one library', async () => {
    const { capability, root } = await boot({
      sidecarEnv: { ASK_KNOWLEDGE_FAKE_HOLD_MS: '40' },
    })
    const library = await capability.createLibrary({ displayName: '并发' })
    const started: number[] = []
    const finished: number[] = []
    const run = async (index: number, filename: string) => {
      started.push(index)
      const result = await ingestText(capability, library.id, filename, `# doc ${index}\n`)
      finished.push(index)
      return result
    }
    const [a, b] = await Promise.all([
      run(1, 'one.md'),
      run(2, 'two.md'),
    ])
    expect(a.status).toBe('applied')
    expect(b.status).toBe('applied')
    expect(finished).toHaveLength(2)
    const raw = await readdir(join(root, 'knowledge-bases', 'libraries', library.id, 'raw'))
    expect(raw).toHaveLength(2)
    expect(started[0]).toBeDefined()
  })

  it('keeps exactly one raw when propose fails and retries via reuseRawPath', async () => {
    const { capability, root, sidecarHome } = await boot({
      sidecarEnv: { ASK_KNOWLEDGE_FAKE_PROPOSE: 'fail' },
    })
    const library = await capability.createLibrary({ displayName: '重试' })
    const failed = await ingestText(capability, library.id, '报销.md', '# 报销\n')
    expect(failed).toMatchObject({
      status: 'failed',
      retryable: true,
      rawRelPath: 'raw/报销.md',
      error: '整理词条失败。',
    })
    const vault = join(root, 'knowledge-bases', 'libraries', library.id)
    expect(await readdir(join(vault, 'raw'))).toEqual(['报销.md'])
    await writeFakeSidecarEnv(sidecarHome, {})
    const retried = await ingestText(capability, library.id, '报销.md', '# unused\n', 'raw/报销.md')
    expect(retried.status).toBe('applied')
    expect(await readdir(join(vault, 'raw'))).toEqual(['报销.md'])
  })

  it('maps sidecar propose English to Chinese', async () => {
    const { capability, sidecarHome } = await boot({
      sidecarEnv: { ASK_KNOWLEDGE_FAKE_PROPOSE: 'LLM returned non-JSON output' },
    })
    const library = await capability.createLibrary({ displayName: '映射' })
    const failed = await ingestText(capability, library.id, '意见.md', '# 意见\n')
    expect(failed.error).toBe('模型没有按词条格式返回。原文已经放进库，请再试一次。')
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_PROPOSE: 'proposal schema invalid' })
    const second = await capability.createLibrary({ displayName: '格式' })
    const invalid = await ingestText(capability, second.id, '意见.md', '# 意见\n')
    expect(invalid.error).toBe('模型给出的词条格式不对，请再试一次。')
  })

  it('recovers a pending apply failure and rejects the old proposal id', async () => {
    const { capability, sidecarHome } = await boot({
      sidecarEnv: {
        ASK_KNOWLEDGE_FAKE_APPLY: 'fail',
        ASK_KNOWLEDGE_FAKE_PROPOSAL_ID: 'prop-old',
        ASK_KNOWLEDGE_FAKE_INBOX: JSON.stringify([{ proposal_id: 'prop-old' }]),
      },
    })
    const library = await capability.createLibrary({ displayName: '补偿' })
    const failed = await ingestText(capability, library.id, '报销.md', '# 报销\n')
    expect(failed).toMatchObject({
      status: 'failed',
      retryable: true,
      proposalId: 'prop-old',
      error: '写入词条失败。',
    })
    await writeFakeSidecarEnv(sidecarHome, {
      ASK_KNOWLEDGE_FAKE_APPLY: 'reject-old',
      ASK_KNOWLEDGE_FAKE_OLD_PROPOSAL_ID: 'prop-old',
      ASK_KNOWLEDGE_FAKE_PROPOSAL_ID: 'prop-new',
    })
    const retried = await ingestText(capability, library.id, '报销.md', '# unused\n', failed.rawRelPath)
    expect(retried).toMatchObject({ status: 'applied', proposalId: 'prop-new' })
  })

  it('reports deferred ingest as not fully written', async () => {
    const { capability } = await boot({
      sidecarEnv: { ASK_KNOWLEDGE_FAKE_APPLY: 'deferred' },
    })
    const library = await capability.createLibrary({ displayName: '延期' })
    const result = await ingestText(capability, library.id, '报销.md', '# 报销\n')
    expect(result).toMatchObject({ status: 'deferred', deferredCount: 1 })
  })

  it('rejects an oversized chunk and an unsupported type', async () => {
    const { capability } = await boot()
    const library = await capability.createLibrary({ displayName: '上限' })
    await expect(capability.beginIngest({ libraryId: library.id, filename: 'x.xls' }))
      .rejects.toMatchObject({ code: 'type-unsupported' })
    await expect(capability.beginIngest({ libraryId: library.id, filename: 'x.docx' }))
      .rejects.toMatchObject({ code: 'type-unsupported' })
    await expect(capability.beginIngest({ libraryId: library.id, filename: 'ok.pdf' }))
      .resolves.toBeTruthy()
    await expect(capability.beginIngest({ libraryId: library.id, filename: 'ok.xlsx' }))
      .resolves.toBeTruthy()
    const handle = await capability.beginIngest({ libraryId: library.id, filename: 'ok.md' })
    const huge = Buffer.alloc(MAX_INGEST_CHUNK_BYTES + 1).toString('base64')
    await expect(capability.appendIngestChunk({ handle, bytes: huge }))
      .rejects.toMatchObject({ code: 'chunk-too-large' })
    expect(() => decodeIngestChunk('aGk')).toThrow()
  })

  it('waits for a held library lock before remove can delete the vault', async () => {
    const { capability, root } = await boot()
    const library = await capability.createLibrary({ displayName: '锁' })
    let removeStarted = false
    let sawVault = false
    const held = withLibraryLock(library.id, async () => {
      await new Promise(resolve => setTimeout(resolve, 30))
      sawVault = true
    })
    const removing = (async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      removeStarted = true
      await capability.removeLibrary({ libraryId: library.id })
    })()
    await Promise.all([held, removing])
    expect(sawVault).toBe(true)
    expect(removeStarted).toBe(true)
    expect(await capability.listLibraries()).toEqual([])
    await expect(readdir(join(root, 'knowledge-bases', 'libraries', library.id)))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })
})

void writeFile
