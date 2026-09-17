/** Ingest barrier, reuseRawPath, apply-failure re-propose, and upload caps. */

import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import type { AskKnowledge } from '@deepseek-ai/dsh-host-ask-knowledge'
import DesktopAskKnowledge from '../src/index.ts'
import { healPageMetaRejections, isPageMetaRejection } from '../src/ingest.ts'
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

describe('ask-knowledge ingest', () => {
  it('applies a markdown fixture through begin/append/finish', async () => {
    const { capability } = await boot()
    const library = await capability.createLibrary({ displayName: '制度' })
    const result = await ingestText(capability, library.id, '报销.md', '# 报销\n\n流程\n')
    expect(result).toMatchObject({ status: 'applied', rawRelPath: 'raw/报销.md' })
  })

  it('unzips Word on the Host and ingests the markdown copy', async () => {
    const { capability, root } = await boot()
    const library = await capability.createLibrary({ displayName: '制度' })
    const result = await ingestBytes(
      capability,
      library.id,
      '制度.docx',
      docxWithParagraphs(['报销流程']),
    )
    expect(result).toMatchObject({ status: 'applied', rawRelPath: 'raw/制度.md' })
    expect(await readFile(
      join(root, 'knowledge-bases', 'libraries', library.id, 'raw', '制度.md'),
      'utf8',
    )).toContain('报销流程')
    await expect(ingestBytes(capability, library.id, '空.docx', docxWithParagraphs([])))
      .rejects.toMatchObject({ message: '这份 Word 没有可提取的文字' })
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

  it('does not treat sidecar apply rejected as applied', async () => {
    const { capability } = await boot({
      sidecarEnv: { ASK_KNOWLEDGE_FAKE_APPLY: 'rejected' },
    })
    const library = await capability.createLibrary({ displayName: '拒写' })
    const result = await ingestText(capability, library.id, '意见.md', '# 意见\n')
    expect(result).toMatchObject({
      status: 'failed',
      error: '整理词条没有写出可检索的页面。',
    })
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
      operations: [{ op: 'create_page', path: 'wiki/a.md', frontmatter: { title: 'A', type, lang: 'zh', role: type, layer: 'wiki', summary: '摘要' } }],
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

    await healPageMetaRejections({ sidecarRuntimePath: sidecarHome }, join(root, 'knowledge-bases', 'libraries', library.id))

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
    await expect(healPageMetaRejections({ sidecarRuntimePath: sidecarHome }, bareVault)).resolves.toBeUndefined()

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
    await expect(healPageMetaRejections({ sidecarRuntimePath: sidecarHome }, vault)).resolves.toBeUndefined()

    const controller = new AbortController()
    controller.abort()
    await expect(healPageMetaRejections({ sidecarRuntimePath: sidecarHome }, vault, controller.signal))
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
      await expect(healPageMetaRejections({ sidecarRuntimePath: sidecarHome }, vault, controller.signal))
        .rejects.toThrow()
    } finally {
      clearTimeout(aborting)
    }
  })
})
