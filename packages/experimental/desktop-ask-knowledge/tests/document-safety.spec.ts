/** Public tool output, durable receipts, conversion admission and cancellation safety. */
import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile, rm, stat, symlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootOverlay } from './helpers/boot.ts'
import * as passageModule from '../src/document-retrieve.ts'
import { indexLibraryVault, searchLibraryPassages, readLibraryPassage } from '../src/document-retrieve.ts'
import { getOrConvertSessionAttachment, readSessionAttachment, searchSessionAttachment } from '../src/session-attachments.ts'
import * as conversionModule from '../src/conversion.ts'
import * as sidecarModule from '../src/sidecar.ts'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import type DesktopAskKnowledge from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
let count = 0
async function boot(python = false) {
  const b = await bootOverlay({ sessions: true, tools: true, pythonSidecar: python })
  cleanups.push(async () => { await b.fiber.dispose(); await rm(b.root, { recursive: true, force: true }) })
  const session = b.ctx.sessions.prepare(SessionId('review-session'))
  b.ctx.sessions.enter(session)
  session.append('turn/start', { turn: 1 })
  const agent = { id: session.id, session } as never
  const call = (name: string, args: object) => b.ctx.tools.execute({
    name, arguments: args, agent, signal: new AbortController().signal, callId: ToolCallId(`review-${++count}`),
  })
  return { ...b, session, call }
}
function conversion(text: string) {
  return { markdown: text, status: 'complete' as const, format: 'txt', sha256: 'a'.repeat(64), byteLength: text.length,
    blocks: [{ id: 'b0', kind: 'paragraph' as const, text, charOffset: 0 }],
    diagnostics: { warnings: [], omissions: [], unsupportedFeatures: [] } }
}
const ref = { attachmentId: AttachmentId('a'.repeat(64)), name: 'large.txt', bytes: 100000 }

it('session search keeps a single large block within a bounded result', () => {
  const result = searchSessionAttachment(conversion('needle ' + 'x'.repeat(100000)), ref, 's', 'needle')
  console.log('SEARCH_BYTES', JSON.stringify(result).length)
  expect(result.items[0]!.text.length).toBeLessThanOrEqual(4000)
})
it('page read keeps a large page bounded with continuation', () => {
  const c = conversion('x'.repeat(100000))
  const result = readSessionAttachment({ ...c, blocks: [{ ...c.blocks[0]!, page: 1 }] }, ref, 's', { page: 1 })
  console.log('PAGE_CHARS', result.text.length, 'CURSOR', !!result.cursor)
  expect(result.text.length).toBeLessThanOrEqual(4000)
})
it('nonpaginated text does not fabricate a page number', () => {
  const result = searchSessionAttachment(conversion('needle'), ref, 's', 'needle')
  expect(result.items[0]!.page).toBeUndefined()
})
it('attachment renderer exposes continuation and partial-conversion diagnostics to the model', async () => {
  const b = await boot()
  const text = 'x'.repeat(40000)
  const digest = createHash('sha256').update(text).digest('hex')
  const attachment = { attachmentId: AttachmentId(digest), name: 'long.txt', bytes: text.length }
  b.session.append('user/message', createUserMessage({ content: [{ type: 'file', attachment }], source: { kind: 'user' } }),
    { surfaceOp: 'append' })
  b.ctx.provide('attachments', { readFileStream: async function* () { yield Buffer.from(text) } })
  const cache = join(b.root, 'attachment-cache')
  await mkdir(cache, { recursive: true })
  vi.spyOn(conversionModule, 'convertSourceFile').mockResolvedValue({ ...conversion(text), status: 'partial',
    diagnostics: { warnings: ['MISSING_FOOTNOTES'], omissions: ['footer'], unsupportedFeatures: [] } })
  const r = await b.call('ask_knowledge_session_document', { action: 'read', filename: 'long.txt' })
  expect(r.isError).toBe(false)
  if (r.isError) return
  const value = r.value as { cursor: string }
  console.log('ATTACHMENT_RENDER', { valueHasCursor: !!value.cursor, renderedChars: JSON.stringify(r.content).length,
    renderedDiagnostics: JSON.stringify(r.content).includes('MISSING_FOOTNOTES') })
  expect(JSON.stringify(r.content).includes(value.cursor)).toBe(true)
  expect(JSON.stringify(r.content).includes('MISSING_FOOTNOTES')).toBe(true)
})
it('a prefix-only cache cannot claim complete without reading the official original', async () => {
  const b = await boot()
  const text = 'full original ' + 'x'.repeat(40000)
  const digest = createHash('sha256').update(text).digest('hex')
  const cache = join(b.root, 'attachment-cache')
  await mkdir(cache, { recursive: true })
  await writeFile(join(cache, `${digest}_v2.json`), JSON.stringify(conversion('prefix only')))
  let reads = 0
  b.ctx.provide('attachments', { readFileStream: async function* () { reads++; yield Buffer.from(text) } })
  const r = await getOrConvertSessionAttachment({ knowledgeHome: b.root }, b.ctx, { attachmentId: AttachmentId(digest),
    name: 'full.txt', bytes: text.length })
  console.log('PREFIX_CACHE', { status: r.status, chars: r.markdown.length, reads })
  expect(r.markdown.length).toBe(text.length)
})
async function wiki() {
  const b = await boot(true)
  const lib = await b.ctx.askKnowledge.createLibrary({ displayName: 'Review' })
  const vault = join(b.root, 'knowledge-bases', 'libraries', lib.id)
  await mkdir(join(vault, 'wiki'), { recursive: true })
  await writeFile(join(vault, 'wiki', 'Policy.md'),
    '---\ntitle: Policy\nrole: concept\n---\n# Policy\n\nPolicy summary claims budget is 999.\n')
  await indexLibraryVault({ sidecarRuntimePath: b.sidecarHome }, b.root, lib.id)
  await b.ctx.askKnowledge.attach({ libraryId: lib.id, sessionId: b.session.id })
  return { ...b, lib, vault }
}
it('wiki retrieval renders passage IDs needed for the read tool', async () => {
  const b = await wiki()
  const r = await b.call('ask_knowledge_retrieve', { terms: ['Policy'] })
  expect(r.isError).toBe(false)
  if (r.isError) return
  const v = r.value as { items: Array<{ passageId: string }> }
  expect(v.items.length).toBeGreaterThan(0)
  expect(JSON.stringify(r.content).includes(v.items[0]!.passageId)).toBe(true)
})
it('reading an LLM wiki summary must not certify it as original-source evidence', async () => {
  const b = await wiki()
  const r = await b.call('ask_knowledge_retrieve', { terms: ['Policy'] })
  if (r.isError) throw new Error(JSON.stringify(r.error))
  const v = r.value as { items: Array<{ passageId: string }>; wikiAttemptId: string }
  const callId = ToolCallId('logged-wiki')
  const call = b.session.append('tool/call', { turn: 1, step: 1, callId, name: 'ask_knowledge_retrieve',
    arguments: JSON.stringify({ terms: ['Policy'] }) })
  b.session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, content: r.content,
    isError: false }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  const read = await b.call('ask_knowledge_read', { passageId: v.items[0]!.passageId, wikiAttemptId: v.wikiAttemptId })
  expect(read.isError).toBe(false)
  if (read.isError) return
  console.log('WIKI_READ_VERIFICATION', read.value)
  expect((read.value as { verification: string }).verification).not.toBe('source-verified')
})
it('lookup preserves access to the tail of a 12000 character wiki page', async () => {
  const b = await wiki()
  await writeFile(join(b.vault, 'wiki', 'Policy.md'),
    '---\ntitle: Policy\nrole: concept\n---\n# Policy\n\n' + 'x'.repeat(12000) + 'FINAL_EXCEPTION')
  const r = await b.call('ask_knowledge_lookup', { term: 'Policy' })
  expect(r.isError).toBe(false)
  if (r.isError) return
  const v = r.value as { text: string; cursor?: string }
  console.log('LOOKUP_TAIL', { chars: v.text?.length, cursor: v.cursor, tail: v.text?.includes('FINAL_EXCEPTION') })
  expect(v.text.includes('FINAL_EXCEPTION') || !!v.cursor).toBe(true)
})
it('conversion admission rejects a 2GiB reference before reading its original', async () => {
  const b = await boot()
  let reads = 0
  b.ctx.provide('attachments', { readFileStream: async function* () { reads++; throw new Error('stop before allocating large original') } })
  await expect(getOrConvertSessionAttachment({ knowledgeHome: b.root }, b.ctx, { ...ref, bytes: 2 * 1024 ** 3 })).rejects.toThrow()
  console.log('OVERSIZED_ORIGINAL_READS', reads)
  expect(reads).toBe(0)
})
it.skipIf(process.platform === 'win32')('original attachment staging uses private owner-only POSIX modes', async () => {
  const b = await boot()
  const text = 'private original'
  const digest = createHash('sha256').update(text).digest('hex')
  b.ctx.provide('attachments', { readFileStream: async function* () { yield Buffer.from(text) } })
  let directoryMode = -1, fileMode = -1
  vi.spyOn(conversionModule, 'convertSourceFile').mockImplementation(async (_config, path) => {
    directoryMode = (await stat(dirname(path))).mode & 0o777
    fileMode = (await stat(path)).mode & 0o777
    return conversion(text)
  })
  const mask = process.umask(0o022)
  try {
    await getOrConvertSessionAttachment({ knowledgeHome: b.root }, b.ctx, { ...ref, attachmentId: AttachmentId(digest),
      bytes: text.length })
  } finally { process.umask(mask) }
  console.log('STAGING_MODES', { directoryMode: directoryMode.toString(8), fileMode: fileMode.toString(8) })
  expect(directoryMode).toBe(0o700)
  expect(fileMode).toBe(0o600)
})
it('source admission requires an actually logged earlier wiki tool result', async () => {
  const b = await wiki()
  await mkdir(join(b.vault, 'raw'), { recursive: true })
  await writeFile(join(b.vault, 'raw', 'source.md'), '# Policy\n\nPolicy original budget 123.\n')
  await indexLibraryVault({ sidecarRuntimePath: b.sidecarHome }, b.root, b.lib.id)
  const r = await b.call('ask_knowledge_retrieve', { terms: ['Policy'] })
  if (r.isError) throw new Error(JSON.stringify(r.error))
  const loggedWikiResults = b.session.snapshotEvents().filter(e => e.type === 'tool/result').length
  expect(loggedWikiResults).toBe(0)
  const source = await b.call('ask_knowledge_retrieve', { terms: ['Policy'], mode: 'source',
    wikiAttemptId: (r.value as { wikiAttemptId: string }).wikiAttemptId })
  console.log('UNLOGGED_SOURCE_ADMISSION', { loggedWikiResults, isError: source.isError })
  expect(source.isError).toBe(true)
})
it('cancel also fences the production retry-conversion path', async () => {
  const b = await boot(true)
  const service = b.ctx.askKnowledge as DesktopAskKnowledge
  const lib = await service.createLibrary({ displayName: 'Retry cancellation' })
  const handle = await service.beginIngest({ libraryId: lib.id, filename: 'broken.docx' })
  await service.appendIngestChunk({ handle, bytes: Buffer.from('invalid docx zip').toString('base64') })
  await service.finishIngest({ handle }).catch(() => {})
  const before = (await service.remoteDocuments(lib.id as never))[0]!
  expect(before.stage).toBe('conversion')
  const started = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  vi.spyOn(conversionModule, 'convertSourceFile').mockImplementation(async () => { started.resolve(undefined)
    await release.promise; return conversion('RETRY_AFTER_CANCEL fact') })
  const retry = service.remoteDocumentAction({ libraryId: lib.id as never, documentId: before.id as never, action: 'retry' })
  const outcome = retry.then(() => 'resolved', e => String(e))
  await started.promise
  const cancelled = service.remoteDocumentAction({ libraryId: lib.id as never, documentId: before.id as never, action: 'cancel' })
  release.resolve(undefined)
  await cancelled
  const finished = await outcome
  const after = (await service.remoteDocuments(lib.id as never))[0]!
  console.log('RETRY_CANCEL', { finished, status: after.status, searchable: after.searchable })
  expect(after.searchable).toBe(false)
})
it('conversion cache respects a lowered configured output ceiling', async () => {
  const b = await boot()
  const text = 'x'.repeat(10000)
  const digest = createHash('sha256').update(text).digest('hex')
  b.ctx.provide('attachments', { readFileStream: async function* () { yield Buffer.from(text) } })
  const r = { ...ref, attachmentId: AttachmentId(digest), bytes: text.length }
  await getOrConvertSessionAttachment({ knowledgeHome: b.root, maxConvertedBytes: 20000 }, b.ctx, r)
  await expect(getOrConvertSessionAttachment({ knowledgeHome: b.root, maxConvertedBytes: 100 }, b.ctx,
    r)).rejects.toThrow(/maximum|allowance|exceeds/)
})
it('public resume forwards the explicit uncertain-outcome decision to the executor', async () => {
  const b = await boot(true)
  const service = b.ctx.askKnowledge as DesktopAskKnowledge
  const lib = await service.createLibrary({ displayName: 'Resume decision' })
  b.ctx.provide('credentials', { resolve: async () => ({ value: 'synthetic-unused' }) })
  let forwarded: unknown
  vi.spyOn(sidecarModule, 'runSidecar').mockImplementation(async (_config, request) => {
    forwarded = request
    return { ok: true } as never
  })
  await service.remoteDocumentAction({ libraryId: lib.id, documentId: 'review-doc', action: 'resume', planHash: 'review-hash',
    approvedTokens: 50000, uncertainOutcome: 'replay' } as never)
  console.log('RESUME_DECISION', forwarded)
  expect((forwarded as { uncertainOutcome?: string }).uncertainOutcome).toBe('replay')
})

it('reads official attachments through the actual Cordis provider', async () => {
  const b = await boot()
  const store = b.ctx.plugin(LocalAttachmentStore, { dshHome: join(b.root, 'official') })
  await store
  cleanups.push(() => store.dispose())
  const attachment = await b.ctx.attachments.saveFile({ name: 'official.txt', data: Buffer.from('ACTUAL_STORE_9172') })
  b.session.append('user/message', createUserMessage({ content: [{ type: 'file', attachment }], source: { kind: 'user' } }),
    { surfaceOp: 'append' })
  const result = await b.call('ask_knowledge_session_document', { filename: 'official.txt' })
  expect(result.isError).toBe(false)
  expect(JSON.stringify(result.content)).toContain('ACTUAL_STORE_9172')
})
it('wiki lookup cannot bypass source admission by opening a raw canonical page', async () => {
  const b = await wiki()
  await mkdir(join(b.vault, 'raw'), { recursive: true })
  await writeFile(join(b.vault, 'raw', 'RawOnly.md'), '# RawOnly\n\nSOURCE_WITHOUT_WIKI_RECEIPT\n')
  const result = await b.call('ask_knowledge_lookup', { term: 'RawOnly' })
  expect(result.isError).toBe(true)
  expect(JSON.stringify(result.content)).not.toContain('SOURCE_WITHOUT_WIKI_RECEIPT')
})

it.skipIf(process.platform === 'win32')('legacy wiki lookup refuses a link to a file outside its vault', async () => {
  const b = await wiki()
  const outside = join(b.root, 'outside-private.md')
  await writeFile(outside, '# LinkedPolicy\n\nOUTSIDE_VAULT_SECRET_7291\n')
  await symlink(outside, join(b.vault, 'wiki', 'LinkedPolicy.md'))
  await expect(b.ctx.askKnowledge.lookup({ libraryId: b.lib.id, term: 'LinkedPolicy' })).rejects.toThrow()
})


it.each(['retry', 'ingest'] as const)('cancel after raw publication keeps %s output out of automatic source indexing',
  async (operation) => {
    const b = await boot(true)
    const service = b.ctx.askKnowledge as DesktopAskKnowledge
    const lib = await service.createLibrary({ displayName: 'Publication cancellation' })
    const vault = join(b.root, 'knowledge-bases', 'libraries', lib.id)
    const handle = await service.beginIngest({ libraryId: lib.id, filename: 'broken.docx' })
    await service.appendIngestChunk({ handle, bytes: Buffer.from('invalid zip').toString('base64') })
    if (operation === 'retry') await service.finishIngest({ handle }).catch(() => {})
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const originalIndex = passageModule.indexLibraryVault
    vi.spyOn(conversionModule, 'convertSourceFile').mockResolvedValue(conversion('CANCELLED_RETRY_SECRET_4471'))
    const pausedIndex = vi.spyOn(passageModule, 'indexLibraryVault').mockImplementation(async (...args) => {
      started.resolve(undefined)
      await release.promise
      return originalIndex(...args)
    })
    const doc = operation === 'retry' ? (await service.remoteDocuments(lib.id as never))[0]! : undefined
    const work = operation === 'retry'
      ? service.remoteDocumentAction({ libraryId: lib.id as never, documentId: doc!.id as never, action: 'retry' })
      : service.finishIngest({ handle })
    const outcome = work.then(() => 'resolved', () => 'rejected')
    await started.promise
    const row = (await service.remoteDocuments(lib.id as never))[0]!
    const cancel = service.remoteDocumentAction({ libraryId: lib.id as never, documentId: row.id as never, action: 'cancel' })
    try {
      await vi.waitFor(async () => expect((await service.remoteDocuments(lib.id as never))[0]!.status).toBe('cancelled'))
      const config = { sidecarRuntimePath: b.sidecarHome }
      const during = await searchLibraryPassages(config, b.root, { libraryId: lib.id, queries: ['CANCELLED_RETRY_SECRET_4471'],
        layer: 'raw' })
      expect(during.items).toEqual([])
    } finally {
      release.resolve(undefined)
      await cancel
      await outcome
      pausedIndex.mockRestore()
    }
    // The leftover file survives, so a fresh search process must enforce durable admission too.
    const files = await import('node:fs/promises').then(fs => fs.readdir(join(vault, 'raw')))
    expect(files.some(name => name.endsWith('.md'))).toBe(true)
    await expect(sidecarModule.runSidecar({ sidecarRuntimePath: b.sidecarHome }, {
      command: 'plan-document', vault, libraryId: lib.id, documentId: row.id,
      revisionId: row.revisionId, rawPath: `raw/${files.find(name => name.endsWith('.md'))}`,
    })).rejects.toThrow(/cancelled conversion/)
    await originalIndex({ sidecarRuntimePath: b.sidecarHome }, b.root, lib.id)
    const after = await searchLibraryPassages({ sidecarRuntimePath: b.sidecarHome }, b.root, { libraryId: lib.id,
      queries: ['CANCELLED_RETRY_SECRET_4471'], layer: 'raw' })
    expect(after.items).toEqual([])
    expect((await service.remoteDocuments(lib.id as never))[0]!.searchable).toBe(false)
  })

it('raw search and continued reads identify exact revision-relative Unicode spans, including table rows', async () => {
  const b = await wiki()
  const source = '# Intro\n' + '😀中前言'.repeat(400) + '\n# Quotas\nZEBRAQUOTA 4471\n\n| 项目 | 值 |\n|---|---|\n' + Array.from({ length: 120 }, (_, n) => `| ZEBRAROW${n} | 😀${n} |\n`).join('')
  await mkdir(join(b.vault, 'raw'), { recursive: true })
  await writeFile(join(b.vault, 'raw', 'spans.md'), source)
  const config = { sidecarRuntimePath: b.sidecarHome }
  const codepoints = [...source]
  for (const query of ['ZEBRAQUOTA', 'ZEBRAROW119']) {
    const result = await searchLibraryPassages(config, b.root, { libraryId: b.lib.id, queries: [query], layer: 'raw' })
    const hit = result.items.find(item => item.text.includes(query))!
    expect(hit).toBeDefined()
    expect(hit.sourceStart).toBeGreaterThan(1000)
    expect(hit.sourceRevision).toBe('sha256:' + createHash('sha256').update(source).digest('hex'))
    expect(codepoints.slice(hit.sourceStart, hit.sourceEnd).join('')).toBe(hit.text)
    let cursor: string | undefined
    do {
      const page = await readLibraryPassage(config, b.root, { libraryId: b.lib.id, passageId: hit.passageId, ...cursor ? { cursor } : {} })
      for (const item of page.items) expect(codepoints.slice(item.sourceStart, item.sourceEnd).join('')).toBe(item.text)
      cursor = page.cursor ?? undefined
    } while (cursor)
  }
})


it('a changed converter identity invalidates a complete conversion cache', async () => {
  const b = await boot()
  const text = 'Converter version original'
  const bytes = Buffer.from(text)
  const digest = createHash('sha256').update(bytes).digest('hex')
  let reads = 0
  b.ctx.provide('attachments', { readFileStream: async function* () { reads++; yield bytes } })
  const reference = { attachmentId: AttachmentId(digest), name: 'version.txt', bytes: bytes.length }
  const config = { knowledgeHome: b.root }
  await getOrConvertSessionAttachment(config, b.ctx, reference)
  const path = join(b.root, 'attachment-cache', `${digest}_v2.json`)
  const cached = JSON.parse(await readFile(path, 'utf8')) as { identity: string }
  const identity = JSON.parse(cached.identity) as { converter: string }
  identity.converter = 'obsolete-converter'
  cached.identity = JSON.stringify(identity)
  await writeFile(path, JSON.stringify(cached))
  const converted = await getOrConvertSessionAttachment(config, b.ctx, reference)
  expect(reads).toBe(2)
  expect(converted.markdown).toContain(text)
})
