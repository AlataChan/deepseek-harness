/** Ingest barrier, reuseRawPath, apply-failure re-propose, and upload caps. */

import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import type { AskKnowledge } from '@deepseek-ai/dsh-host-ask-knowledge'
import DesktopAskKnowledge, { type Config as DesktopAskKnowledgeConfig } from '../src/index.ts'
import { finishIngestPipeline, healRejectedProposals, isPageMetaRejection, isPostLintRejection } from '../src/ingest.ts'
import * as retrieval from '../src/document-retrieve.ts'
import { withLibraryLock } from '../src/library-lock.ts'
import { decodeIngestChunk, MAX_INGEST_CHUNK_BYTES, recoverUploadTemp } from '../src/upload-temp.ts'
import { installFakeSidecar, installPythonSidecar, writeFakeSidecarEnv } from './helpers/install-sidecar.ts'
import { PROCESS_INTEGRATION_TIMEOUT } from './helpers/process-integration-timeout.ts'

const KEY = credentialRef('DEEPSEEK_API_KEY')
const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function boot(options: {
  sidecarEnv?: NodeJS.ProcessEnv
  realSidecar?: boolean
  config?: Partial<DesktopAskKnowledgeConfig>
  seedBeforeBoot?: (root: string) => Promise<void>
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ask-knowledge-ingest-'))
  const sidecarHome = join(root, 'sidecar')
  await (options.realSidecar ? installPythonSidecar(sidecarHome) : installFakeSidecar(sidecarHome))
  if (options.sidecarEnv !== undefined) {
    const overlay: Record<string, string> = {}
    for (const [key, value] of Object.entries(options.sidecarEnv)) {
      if (value !== undefined) overlay[key] = value
    }
    await writeFakeSidecarEnv(sidecarHome, overlay)
  }
  if (options.seedBeforeBoot !== undefined) {
    await options.seedBeforeBoot(root)
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
    ...options.config,
  })
  await fiber.await()
  cleanups.push(() => fiber.dispose())
  return { ctx, root, sidecarHome, capability: ctx.askKnowledge }
}

function docxWithParagraphs(paragraphs: readonly string[]): Uint8Array {
  const body = paragraphs.map(text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  return zipSync({ 'word/document.xml': strToU8(xml) })
}

async function ingestBytes(
  capability: AskKnowledge,
  libraryId: Parameters<AskKnowledge['beginIngest']>[0]['libraryId'],
  filename: string,
  body: Uint8Array,
) {
  const handle = await capability.beginIngest({ libraryId, filename })
  await capability.appendIngestChunk({ handle, bytes: Buffer.from(body).toString('base64') })
  return capability.finishIngest({ handle })
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

async function legacyText(
  harness: Awaited<ReturnType<typeof boot>>,
  libraryId: Parameters<AskKnowledge['beginIngest']>[0]['libraryId'],
  filename: string,
  body: string,
  reuseRawPath?: string,
) {
  const tempPath = join(harness.root, filename)
  await writeFile(tempPath, body, 'utf8')
  return finishIngestPipeline(harness.ctx, { sidecarRuntimePath: harness.sidecarHome }, harness.root, {
    libraryId, tempPath, ...(reuseRawPath === undefined ? {} : { reuseRawPath }),
  })
}

describe('ask-knowledge ingest', () => {
  it('retains and indexes a markdown fixture while awaiting explicit extraction approval', async () => {
    const { capability } = await boot({ realSidecar: true })
    const library = await capability.createLibrary({ displayName: '制度' })
    const result = await ingestText(capability, library.id, '报销.md', '# 报销\n\n流程\n')
    expect(result.status).toBe('deferred')
    expect(result.rawRelPath).toMatch(/^raw\/doc-.+-rev-.+\.md$/)
  })

  it('unzips Word on the Host and ingests the markdown copy', async () => {
    const { capability, root } = await boot({ realSidecar: true })
    const library = await capability.createLibrary({ displayName: '制度' })
    const result = await ingestBytes(
      capability,
      library.id,
      '制度.docx',
      docxWithParagraphs(['报销流程']),
    )
    expect(result.status).toBe('deferred')
    expect(result.rawRelPath).toMatch(/^raw\/doc-.+-rev-.+\.md$/)
    expect(await readFile(
      join(root, 'knowledge-bases', 'libraries', library.id, result.rawRelPath!),
      'utf8',
    )).toContain('报销流程')
    await expect(ingestBytes(capability, library.id, '空.docx', docxWithParagraphs([])))
      .rejects.toMatchObject({ message: '这份 Word 没有可提取的文字' })
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('retains both same-name files across overlapping public uploads', async () => {
    const { capability, root } = await boot({ realSidecar: true })
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
      run(1, 'same.md'),
      run(2, 'same.md'),
    ])
    expect(a.status).toBe('deferred')
    expect(b.status).toBe('deferred')
    expect(a.rawRelPath).not.toBe(b.rawRelPath)
    const vault = join(root, 'knowledge-bases', 'libraries', library.id)
    expect(await readFile(join(vault, a.rawRelPath!), 'utf8')).toContain('doc 1')
    expect(await readFile(join(vault, b.rawRelPath!), 'utf8')).toContain('doc 2')
    expect(finished).toHaveLength(2)
    const raw = await readdir(join(root, 'knowledge-bases', 'libraries', library.id, 'raw'))
    expect(raw).toHaveLength(2)
    expect(started[0]).toBeDefined()
  })

  it('keeps exactly one raw when propose fails and retries via reuseRawPath', async () => {
    const harness = await boot({
      sidecarEnv: { ASK_KNOWLEDGE_FAKE_PROPOSE: 'fail' },
    })
    const { capability, root, sidecarHome } = harness
    const library = await capability.createLibrary({ displayName: '重试' })
    const failed = await legacyText(harness, library.id, '报销.md', '# 报销\n')
    expect(failed).toMatchObject({
      status: 'failed',
      retryable: true,
      rawRelPath: 'raw/报销.md',
      error: '整理词条失败。',
    })
    const vault = join(root, 'knowledge-bases', 'libraries', library.id)
    expect(await readdir(join(vault, 'raw'))).toEqual(['报销.md'])
    await writeFakeSidecarEnv(sidecarHome, {})
    const retried = await legacyText(harness, library.id, '报销.md', '# unused\n', 'raw/报销.md')
    expect(retried.status).toBe('applied')
    expect(await readdir(join(vault, 'raw'))).toEqual(['报销.md'])
  })

  it('maps sidecar propose English to Chinese', async () => {
    const harness = await boot({
      sidecarEnv: { ASK_KNOWLEDGE_FAKE_PROPOSE: 'LLM returned non-JSON output' },
    })
    const { capability, sidecarHome } = harness
    const library = await capability.createLibrary({ displayName: '映射' })
    const failed = await legacyText(harness, library.id, '意见.md', '# 意见\n')
    expect(failed.error).toBe('模型没有按词条格式返回。原文已经放进库，请再试一次。')
    await writeFakeSidecarEnv(sidecarHome, { ASK_KNOWLEDGE_FAKE_PROPOSE: 'proposal schema invalid' })
    const second = await capability.createLibrary({ displayName: '格式' })
    const invalid = await legacyText(harness, second.id, '意见.md', '# 意见\n')
    expect(invalid.error).toBe('模型给出的词条格式不对，请再试一次。')
  })

  it('recovers a pending apply failure and rejects the old proposal id', async () => {
    const harness = await boot({
      sidecarEnv: {
        ASK_KNOWLEDGE_FAKE_APPLY: 'fail',
        ASK_KNOWLEDGE_FAKE_PROPOSAL_ID: 'prop-old',
        ASK_KNOWLEDGE_FAKE_INBOX: JSON.stringify([{ proposal_id: 'prop-old' }]),
      },
    })
    const { capability, sidecarHome } = harness
    const library = await capability.createLibrary({ displayName: '补偿' })
    const failed = await legacyText(harness, library.id, '报销.md', '# 报销\n')
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
    const retried = await legacyText(harness, library.id, '报销.md', '# unused\n', failed.rawRelPath)
    expect(retried).toMatchObject({ status: 'applied', proposalId: 'prop-new' })
  })

  it('does not treat sidecar apply rejected as applied', async () => {
    const harness = await boot({
      sidecarEnv: { ASK_KNOWLEDGE_FAKE_APPLY: 'rejected' },
    })
    const { capability } = harness
    const library = await capability.createLibrary({ displayName: '拒写' })
    const result = await legacyText(harness, library.id, '意见.md', '# 意见\n')
    expect(result).toMatchObject({
      status: 'failed',
      error: '整理词条没有写出可检索的页面。',
    })
  })

  it('reports deferred ingest as not fully written', async () => {
    const harness = await boot({
      sidecarEnv: { ASK_KNOWLEDGE_FAKE_APPLY: 'deferred' },
    })
    const { capability } = harness
    const library = await capability.createLibrary({ displayName: '延期' })
    const result = await legacyText(harness, library.id, '报销.md', '# 报销\n')
    expect(result).toMatchObject({ status: 'deferred', deferredCount: 1 })
  })

  it('names the lint rule and page when a proposal fails the post-apply lint', async () => {
    const harness = await boot({
      sidecarEnv: { ASK_KNOWLEDGE_FAKE_APPLY: 'rejected-post-lint' },
    })
    const { capability } = harness
    const library = await capability.createLibrary({ displayName: '词条冲突' })
    const result = await legacyText(harness, library.id, '冲突.md', '# 冲突\n')
    expect(result).toMatchObject({ status: 'failed', retryable: true })
    expect(result.error).toContain('同一个别名指向了多个词条')
    expect(result.error).toContain('wiki/a.md,wiki/b.md')
  })

  it('rejects an oversized chunk and an unsupported type', async () => {
    const { capability } = await boot()
    const library = await capability.createLibrary({ displayName: '上限' })
    await expect(capability.beginIngest({ libraryId: library.id, filename: 'x.xls' }))
      .rejects.toMatchObject({ code: 'type-unsupported' })
    await expect(capability.beginIngest({ libraryId: library.id, filename: 'x.pptx' }))
      .rejects.toMatchObject({ code: 'type-unsupported' })
    await expect(capability.beginIngest({ libraryId: library.id, filename: 'ok.pdf' }))
      .resolves.toBeTruthy()
    await expect(capability.beginIngest({ libraryId: library.id, filename: 'ok.xlsx' }))
      .resolves.toBeTruthy()
    await expect(capability.beginIngest({ libraryId: library.id, filename: 'ok.docx' }))
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

  it('classifies only page-meta rejections as recoverable', () => {
    expect(isPageMetaRejection('x')).toBe(false)
    expect(isPageMetaRejection({ rule_id: 'lint.broken_link' })).toBe(false)
    expect(isPageMetaRejection({ rule_id: 'schema.page_meta_invalid' })).toBe(true)
    expect(isPageMetaRejection({ rule_results: [null, 3] })).toBe(false)
    expect(isPageMetaRejection({ rule_results: [{ rule_id: 'schema.page_meta_invalid' }] })).toBe(true)
    expect(isPostLintRejection({ reason: 'post-apply lint failed' })).toBe(true)
    expect(isPostLintRejection({ rule_results: [{ rule_id: 'ALIAS_COLLISION' }] })).toBe(true)
    expect(isPostLintRejection({ rule_id: 'schema.page_meta_invalid' })).toBe(false)
    expect(isPostLintRejection({ rule_results: [{ rule_id: 'lint.broken_link' }] })).toBe(false)
  })

  it('drops tag-derived aliases from a post-lint rejection and re-applies it', async () => {
    const { capability, root, sidecarHome } = await boot()
    const library = await capability.createLibrary({ displayName: '救援' })
    const octopus = join(root, 'knowledge-bases', 'libraries', library.id, '.octopus-kb')
    await mkdir(join(octopus, 'proposals'), { recursive: true })
    await mkdir(join(octopus, 'rejections'), { recursive: true })
    const proposal = {
      id: 'prop-alias',
      status: 'pending',
      operations: [{
        op: 'create_page',
        path: 'wiki/a.md',
        frontmatter: {
          title: 'A',
          type: 'note',
          lang: 'zh',
          role: 'note',
          layer: 'wiki',
          summary: '摘要',
          tags: ['多代理', '治理'],
          aliases: ['多代理', '治理', '自己写的别名'],
        },
      }],
    }
    await writeFile(join(octopus, 'proposals', 'prop-alias.json'), JSON.stringify(proposal), 'utf8')
    // The pre-fix record shape: a reason with no rule_results at all.
    await writeFile(join(octopus, 'rejections', 'prop-alias.json'), JSON.stringify({
      ...proposal,
      decision_status: 'rejected_post_lint',
      reason: 'post-apply lint failed',
    }), 'utf8')

    await healRejectedProposals({ sidecarRuntimePath: sidecarHome }, join(root, 'knowledge-bases', 'libraries', library.id))

    const healed = JSON.parse(await readFile(join(octopus, 'proposals', 'prop-alias.json'), 'utf8')) as {
      operations: Array<{ frontmatter: Record<string, unknown> }>
    }
    // Only the aliases that repeat a tag go; the model's own alias stays.
    expect(healed.operations[0]!.frontmatter['aliases']).toEqual(['自己写的别名'])
  })

  it('heals page-meta rejections and leaves every other rejection alone', async () => {
    const { capability, root, sidecarHome } = await boot()
    const library = await capability.createLibrary({ displayName: '修复' })
    const octopus = join(root, 'knowledge-bases', 'libraries', library.id, '.octopus-kb')
    await mkdir(join(octopus, 'proposals'), { recursive: true })
    await mkdir(join(octopus, 'rejections'), { recursive: true })
    const page = (id: string, type: string) => ({
      id,
      status: 'pending',
      operations: [{ op: 'create_page', path: 'wiki/a.md', frontmatter: { title: 'A', type, lang: 'zh', role: type,
        layer: 'wiki', summary: '摘要' } }],
    })
    const rejection = (id: string, frontmatter: Record<string, unknown>, rule_id: string) => ({
      ...page(id, String(frontmatter.type)),
      rule_id,
      rule_results: [{ rule_id, verdict: 'reject' }],
    })
    const write = async (dir: 'proposals' | 'rejections', name: string, body: string) => {
      await writeFile(join(octopus, dir, name), body, 'utf8')
    }
    await write('proposals', 'prop-heal.json', JSON.stringify(page('prop-heal', 'wiki')))
    await write('rejections', 'prop-heal.json', JSON.stringify(rejection('prop-heal', { type: 'wiki' }, 'schema.page_meta_invalid')))
    await write('proposals', 'prop-array.json', JSON.stringify(page('prop-array', 'invoice')))
    await write('rejections', 'prop-array.json', JSON.stringify({
      ...page('prop-array', 'invoice'),
      rule_results: [{ rule_id: 'other' }, { rule_id: 'schema.page_meta_invalid', verdict: 'reject' }],
    }))
    await write('proposals', 'prop-valid.json', JSON.stringify(page('prop-valid', 'note')))
    await write('rejections', 'prop-valid.json', JSON.stringify(rejection('prop-valid', { type: 'note' }, 'schema.page_meta_invalid')))
    await write('proposals', 'prop-other.json', JSON.stringify(page('prop-other', 'wiki')))
    await write('rejections', 'prop-other.json', JSON.stringify(rejection('prop-other', { type: 'wiki' }, 'lint.broken_link')))
    await write('rejections', 'prop-orphan.json', JSON.stringify(rejection('prop-orphan', { type: 'wiki' }, 'schema.page_meta_invalid')))
    await write('rejections', 'prop-bad.json', '{not json')
    await write('rejections', 'prop-null.json', 'null')
    await write('rejections', 'notes.txt', 'ignored\n')

    await healRejectedProposals({ sidecarRuntimePath: sidecarHome }, join(root, 'knowledge-bases', 'libraries', library.id))

    const frontmatterOf = async (name: string) => {
      const parsed = JSON.parse(await readFile(join(octopus, 'proposals', name), 'utf8')) as {
        operations: Array<{ frontmatter: Record<string, unknown> }>
      }
      return parsed.operations[0]!.frontmatter
    }
    expect(await frontmatterOf('prop-heal.json')).toMatchObject({ type: 'note', role: 'note' })
    expect(await frontmatterOf('prop-array.json')).toMatchObject({ type: 'note', role: 'note' })
    expect(await frontmatterOf('prop-valid.json')).toMatchObject({ type: 'note' })
    expect(await frontmatterOf('prop-other.json')).toMatchObject({ type: 'wiki' })
    await expect(readFile(join(octopus, 'proposals', 'prop-orphan.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps a failed apply and an absent rejections directory harmless', async () => {
    const { capability, root, sidecarHome } = await boot({ sidecarEnv: { ASK_KNOWLEDGE_FAKE_APPLY: 'fail' } })
    const bare = await capability.createLibrary({ displayName: '空' })
    const bareVault = join(root, 'knowledge-bases', 'libraries', bare.id)
    await expect(healRejectedProposals({ sidecarRuntimePath: sidecarHome }, bareVault)).resolves.toBeUndefined()

    const library = await capability.createLibrary({ displayName: '失败' })
    const vault = join(root, 'knowledge-bases', 'libraries', library.id)
    const octopus = join(vault, '.octopus-kb')
    await mkdir(join(octopus, 'proposals'), { recursive: true })
    await mkdir(join(octopus, 'rejections'), { recursive: true })
    const body = JSON.stringify({
      id: 'prop-fail',
      status: 'pending',
      operations: [{ op: 'create_page', path: 'wiki/a.md', frontmatter: { title: 'A', type: 'wiki', lang: 'zh', role: 'wiki' } }],
    })
    await writeFile(join(octopus, 'proposals', 'prop-fail.json'), body, 'utf8')
    await writeFile(join(octopus, 'rejections', 'prop-fail.json'), JSON.stringify({
      ...JSON.parse(body) as object,
      rule_id: 'schema.page_meta_invalid',
    }), 'utf8')
    await expect(healRejectedProposals({ sidecarRuntimePath: sidecarHome }, vault)).resolves.toBeUndefined()

    const controller = new AbortController()
    controller.abort()
    await expect(healRejectedProposals({ sidecarRuntimePath: sidecarHome }, vault, controller.signal))
      .rejects.toThrow()
  })

  it('propagates an abort raised while a heal apply is in flight', async () => {
    const { capability, root, sidecarHome } = await boot({
      sidecarEnv: { ASK_KNOWLEDGE_FAKE_HOLD_MS: '1000' },
    })
    const library = await capability.createLibrary({ displayName: '中止' })
    const vault = join(root, 'knowledge-bases', 'libraries', library.id)
    const octopus = join(vault, '.octopus-kb')
    await mkdir(join(octopus, 'proposals'), { recursive: true })
    await mkdir(join(octopus, 'rejections'), { recursive: true })
    const body = {
      id: 'prop-abort',
      status: 'pending',
      operations: [{ op: 'create_page', path: 'wiki/a.md', frontmatter: { title: 'A', type: 'wiki', lang: 'zh', role: 'wiki' } }],
    }
    await writeFile(join(octopus, 'proposals', 'prop-abort.json'), JSON.stringify(body), 'utf8')
    await writeFile(join(octopus, 'rejections', 'prop-abort.json'), JSON.stringify({
      ...body,
      rule_id: 'schema.page_meta_invalid',
    }), 'utf8')
    const controller = new AbortController()
    const aborting = setTimeout(() => { controller.abort() }, 50)
    try {
      await expect(healRejectedProposals({ sidecarRuntimePath: sidecarHome }, vault, controller.signal))
        .rejects.toThrow()
    } finally {
      clearTimeout(aborting)
    }
  })

  it('cleans up upload temp directories on append failure, abortIngest, finish abort, and cold startup', async () => {
    const { capability, root } = await boot({
      seedBeforeBoot: async (home) => {
        const orphanDir = join(home, 'tmp', 'orphan-before-boot')
        await mkdir(orphanDir, { recursive: true })
        await writeFile(join(orphanDir, 'stale.md'), 'orphan', 'utf8')
      },
    })
    const library = await capability.createLibrary({ displayName: '清理' })

    // 1. appendIngestChunk failure disposes upload immediately (and beginIngest awaited this.ready, removing orphan-before-boot)
    const hFail = await capability.beginIngest({ libraryId: library.id, filename: 'fail.md' })
    expect(await readdir(join(root, 'tmp'))).not.toContain('orphan-before-boot')
    expect((await readdir(join(root, 'tmp'))).length).toBe(1)
    const huge = Buffer.alloc(MAX_INGEST_CHUNK_BYTES + 1).toString('base64')
    await expect(capability.appendIngestChunk({ handle: hFail, bytes: huge }))
      .rejects.toMatchObject({ code: 'chunk-too-large' })
    expect(await readdir(join(root, 'tmp'))).toEqual([])
    await expect(capability.finishIngest({ handle: hFail }))
      .rejects.toMatchObject({ code: 'ingest-failed' })

    // 2. abortIngest and remoteAbortIngest dispose open uploads and no-op unknown handles
    const service = capability as DesktopAskKnowledge
    const hAbort = await capability.beginIngest({ libraryId: library.id, filename: 'abort.md' })
    await capability.appendIngestChunk({ handle: hAbort, bytes: Buffer.from('partial', 'utf8').toString('base64') })
    expect((await readdir(join(root, 'tmp'))).length).toBe(1)
    await service.remoteAbortIngest({ handle: hAbort })
    expect(await readdir(join(root, 'tmp'))).toEqual([])
    // Second abort on already-disposed handle is a safe no-op
    await service.abortIngest({ handle: hAbort })
    await service.abortExtract({ handle: hAbort })

    // 3. Aborted signal passed to finishIngest still cleans up the staging directory
    const hFinishAbort = await capability.beginIngest({ libraryId: library.id, filename: 'abort-finish.md' })
    await capability.appendIngestChunk({ handle: hFinishAbort, bytes: Buffer.from('body', 'utf8').toString('base64') })
    const aborted = new AbortController()
    aborted.abort()
    await expect(capability.finishIngest({ handle: hFinishAbort }, aborted.signal))
      .rejects.toThrow()
    expect(await readdir(join(root, 'tmp'))).toEqual([])

    // 4. recoverUploadTemp preserves active directories and removes stale ones
    const activeDir = join(root, 'tmp', 'active-1')
    const staleDir = join(root, 'tmp', 'stale-2')
    await mkdir(activeDir, { recursive: true })
    await mkdir(staleDir, { recursive: true })
    await recoverUploadTemp(root, new Set([activeDir]))
    expect(await readdir(join(root, 'tmp'))).toEqual(['active-1'])
  })

  it('fences finishIngest when abortIngest is called after conversion reads input so cancelled uploads never publish raw text',
    async () => {
      const { capability, root } = await boot({ realSidecar: true })
      const service = capability as DesktopAskKnowledge
      const library = await capability.createLibrary({ displayName: '取消围栏' })
      const handle = await capability.beginIngest({ libraryId: library.id, filename: 'cancel-mid-convert.docx' })
      const docxBytes = docxWithParagraphs(['CANCEL9911'])
      await capability.appendIngestChunk({ handle, bytes: Buffer.from(docxBytes).toString('base64') })

      // Hold the library lock while finishIngest reads the input and runs convertSourceFile, call abortIngest before publication, then
      // release the lock.
      let releaseLock!: () => void
      const lockHeld = new Promise<void>((resolve) => { releaseLock = resolve })
      let lockAcquired!: () => void
      const acquiredPromise = new Promise<void>((resolve) => { lockAcquired = resolve })
      const lockTask = withLibraryLock(library.id, async () => {
        lockAcquired()
        await lockHeld
      })
      await acquiredPromise

      const finishPromise = capability.finishIngest({ handle })
      // Give finishIngest time to read input and complete convertSourceFile while waiting on withLibraryLock
      await new Promise(resolve => setTimeout(resolve, 250))
      await service.abortIngest({ handle })
      releaseLock()
      await lockTask

      await expect(finishPromise).rejects.toThrow(/cancelled|aborted/)
      expect(await readdir(join(root, 'tmp'))).toEqual([])
      await expect(capability.retrieveBundle({ libraryId: library.id, terms: ['CANCEL9911'] }))
        .rejects.toMatchObject({ code: 'no-hit' })
      const docs = await service.remoteDocuments(library.id as never)
      expect(docs.every(d => !d.searchable)).toBe(true)
    }, PROCESS_INTEGRATION_TIMEOUT)

  it('records cancellation after raw publication instead of leaving a processing conversion', async () => {
    const { capability, root } = await boot({ realSidecar: true })
    const service = capability as DesktopAskKnowledge
    const library = await capability.createLibrary({ displayName: '发布后取消' })
    const handle = await capability.beginIngest({ libraryId: library.id, filename: 'cancel-published.md' })
    await capability.appendIngestChunk({ handle, bytes: Buffer.from('CANCEL_AFTER_PUBLISH_9031').toString('base64') })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const original = retrieval.indexLibraryVault
    const mock = vi.spyOn(retrieval, 'indexLibraryVault').mockImplementationOnce(async (...args) => {
      entered.resolve(undefined)
      await release.promise
      return original(...args)
    })
    const finishing = capability.finishIngest({ handle })
    const outcome = finishing.then(() => undefined, error => error)
    try {
      await entered.promise
      const vault = join(root, 'knowledge-bases', 'libraries', library.id)
      expect((await readdir(join(vault, 'raw'))).some(name => name.endsWith('.md'))).toBe(true)
      await service.abortIngest({ handle })
      release.resolve(undefined)
      expect(await outcome).toBeInstanceOf(Error)
      const docs = await service.remoteDocuments(library.id)
      expect(docs).toHaveLength(1)
      expect(docs[0]).toMatchObject({ status: 'cancelled', searchable: false })
    } finally {
      release.resolve(undefined)
      await outcome
      mock.mockRestore()
    }
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('opens old libraries through the public document list and keeps modern imports distinct', async () => {
    const { capability, root } = await boot({ realSidecar: true })
    const service = capability as DesktopAskKnowledge
    const library = await capability.createLibrary({ displayName: '旧库列表' })
    const vault = join(root, 'knowledge-bases', 'libraries', library.id)
    await writeFile(join(vault, 'raw', 'old-policy.md'), 'LEGACY_POLICY_1199')
    const docs = await service.remoteDocuments(library.id)
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ filename: 'old-policy.md', originalAvailable: false, searchable: true })
    await ingestText(capability, library.id, 'new-policy.md', 'MODERN_POLICY_1199')
    expect(await service.remoteDocuments(library.id)).toHaveLength(2)
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('enforces configurable maxConvertedBytes and maxDocxXmlBytes at the boundary and retains source on refusal', async () => {
    const { capability } = await boot({
      realSidecar: true,
      config: {
        maxConvertedBytes: 1024,
        maxDocxXmlBytes: 1024,
        conversionTimeoutMs: 30_000,
      },
    })
    const service = capability as DesktopAskKnowledge
    const library = await capability.createLibrary({ displayName: '配额' })

    // Boundary pass for maxConvertedBytes (1024 UTF-8 bytes)
    const exact1024 = `# ${'a'.repeat(1021)}\n`
    expect(Buffer.byteLength(exact1024, 'utf8')).toBe(1024)
    const okMd = await ingestText(capability, library.id, 'boundary-ok.md', exact1024)
    expect(okMd.status).toBe('deferred')

    // 1 byte beyond maxConvertedBytes (1025 UTF-8 bytes) fails conversion while retaining original source
    const over1025 = `# ${'a'.repeat(1022)}\n`
    expect(Buffer.byteLength(over1025, 'utf8')).toBe(1025)
    await expect(ingestText(capability, library.id, 'boundary-over.md', over1025))
      .rejects.toThrow(/exceeds maximum allowed 1024 bytes/)

    // DOCX XML entry within maxDocxXmlBytes (1024 bytes) succeeds
    const smallDocx = docxWithParagraphs(['短段落'])
    const okDocx = await ingestBytes(capability, library.id, 'small.docx', smallDocx)
    expect(okDocx.status).toBe('deferred')

    // DOCX XML entry exceeding maxDocxXmlBytes (1024 bytes) fails conversion while retaining original source
    const bigDocx = docxWithParagraphs(['超长段落'.repeat(120)])
    await expect(ingestBytes(capability, library.id, 'big.docx', bigDocx))
      .rejects.toMatchObject({ code: 'ingest-failed', message: '这份 Word 太大，读不了' })

    const docs = await service.remoteDocuments(library.id as never)
    const overDoc = docs.find(d => d.filename === 'boundary-over.md')
    const bigDoc = docs.find(d => d.filename === 'big.docx')
    expect(overDoc).toMatchObject({ status: 'failed', originalAvailable: true })
    expect(bigDoc).toMatchObject({ status: 'failed', originalAvailable: true })
  }, PROCESS_INTEGRATION_TIMEOUT)
})
