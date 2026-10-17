#!/usr/bin/env node
/** Exercise public Host operations using only the installed application runtime. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire, registerHooks } from 'node:module'
import { existsSync, realpathSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const resources = process.argv[2] ? realpathSync(resolve(process.argv[2])) : ''
if (!process.argv[2] || !existsSync(join(resources, 'harness', 'package.json'))) throw new Error('Installed resources directory is required')
const harnessRequire = createRequire(join(resources, 'harness', 'package.json'))
const insideBundle = path => {
  const rel = relative(resources, path)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Installed product import escaped the bundle: ${path}`)
  return path
}
// Seeded overlays deliberately omit workspace dependencies; use the same installed
// Harness closure for those imports, never a checkout or global npm installation.
const inside = path => {
  const rel = relative(resources, path)
  return !rel.startsWith('..') && !isAbsolute(rel)
}
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const productParent = context.parentURL?.startsWith('file:') && inside(fileURLToPath(context.parentURL))
    const bare = !specifier.startsWith('.') && !specifier.startsWith('file:') && !isAbsolute(specifier)
    let result
    try { result = next(specifier, context) } catch (error) {
      if (!productParent || !bare || error.code !== 'ERR_MODULE_NOT_FOUND') throw error
      return next(pathToFileURL(insideBundle(harnessRequire.resolve(specifier))).href, context)
    }
    if (productParent && result.url.startsWith('file:') && !inside(fileURLToPath(result.url))) {
      if (!bare) throw new Error(`Installed product import escaped its bundle: ${specifier}`)
      return next(pathToFileURL(insideBundle(harnessRequire.resolve(specifier))).href, context)
    }
    return result
  },
})
const { Context } = await import(pathToFileURL(insideBundle(harnessRequire.resolve('@deepseek-ai/cordis'))).href)
const modulePath = insideBundle(join(resources, 'profile-plugins', '@deepseek-ai', 'dsh-experimental-desktop-ask-knowledge', 'lib', 'index.js'))
const { default: DesktopAskKnowledge, searchLibraryPassages } = await import(pathToFileURL(modulePath).href)
assert.equal(typeof DesktopAskKnowledge, 'function', 'Installed Host implementation is missing')
assert.equal(typeof searchLibraryPassages, 'function', 'Installed search capability is missing')
const { SessionStore, SessionId } = await import(pathToFileURL(insideBundle(harnessRequire.resolve('@deepseek-ai/dsh-session'))).href)
const { default: Projections } = await import(pathToFileURL(insideBundle(harnessRequire.resolve('@deepseek-ai/dsh-session-projection'))).href)
const { default: Tools } = await import(pathToFileURL(insideBundle(harnessRequire.resolve('@deepseek-ai/dsh-tools'))).href)
const FencePolicy = await import(pathToFileURL(insideBundle(harnessRequire.resolve('@deepseek-ai/dsh-fence-policy'))).href)
const { default: Attachments } = await import(pathToFileURL(insideBundle(harnessRequire.resolve('@deepseek-ai/dsh-attachment-local'))).href)
const { createToolResultMessage, createUserMessage, ToolCallId } = await import(pathToFileURL(insideBundle(harnessRequire.resolve('@deepseek-ai/dsh-llm'))).href)

async function installToolServices(context, profileHome) {
  await context.plugin(SessionStore)
  await context.plugin(Projections)
  await context.plugin(Tools)
  await context.plugin(FencePolicy, { tools: ['ask_knowledge_*'], maxMixedTextBytes: 6000 })
  await context.plugin(Attachments, { dshHome: join(profileHome, 'official-attachments') })
}
let nextToolId = 0
async function tool(context, session, name, args, logged = true) {
  const callId = ToolCallId(`installed-tool-${++nextToolId}`)
  const event = logged ? session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) }) : undefined
  const result = await context.tools.execute({ callId, name, arguments: args,
    agent: { id: session.id, session }, signal: new AbortController().signal })
  if (event) session.append('tool/result', { turn: 1, step: 1,
    message: createToolResultMessage({ callId, content: result.content, isError: result.isError }) }, { surfaceOp: 'append', sourceEventSeqs: [event.seq] })
  return result
}
function modelValue(result) {
  assert.equal(result.isError, false, JSON.stringify(result.error))
  assert.equal(result.content.length, 1)
  assert.equal(result.content[0].type, 'text')
  const prefix = '<external-data>\n'
  const suffix = '\n</external-data>'
  const text = result.content[0].text
  assert.ok(text.startsWith(prefix) && text.endsWith(suffix), 'Installed production safety policy must fence every knowledge result')
  return JSON.parse(text.slice(prefix.length, -suffix.length))
}

if (process.argv[3] === '--restore-tools') {
  const profileHome = process.argv[4]
  const seed = JSON.parse(await readFile(process.argv[5], 'utf8'))
  const context = new Context()
  context.provide('systemPrompt', { getSectionOrder: () => 0, section: () => () => {}, tools: () => () => {} })
  await installToolServices(context, profileHome)
  await context.plugin(DesktopAskKnowledge, { knowledgeHome: profileHome, sidecarRuntimePath: join(resources, 'kb-runtime') })
  try {
    const session = context.sessions.prepare(SessionId(seed.id), { seed: seed.events })
    const detach = context.sessions.enter(session)
    context.sessions.announce(session)
    const restored = modelValue(await tool(context, session, 'ask_knowledge_retrieve', { terms: ['培训预算'], mode: 'source', wikiAttemptId: seed.receipt }))
    assert.ok(restored.items.some(item => item.sourceRevision && item.verification === 'source-verified'))
    let cursor, full = '', count = 0
    do {
      const page = modelValue(await tool(context, session, 'ask_knowledge_session_document', { filename: 'installed-session-long.txt', action: 'read', ...cursor ? { cursor } : {} }))
      full += page.text; cursor = page.cursor
      assert.ok(++count < 200)
    } while (cursor)
    assert.equal(createHash('sha256').update(full).digest('hex'), seed.textHash)
    detach()
    assert.equal((await tool(context, session, 'ask_knowledge_session_document', { filename: 'installed-session-long.txt' })).isError, true)
    process.stdout.write(JSON.stringify({ ok: true, separateProcess: true, receiptRestored: true, completeAttachment: true, deletedSessionRefused: true }) + '\n')
  } finally { await context.fiber.dispose(); hooks.deregister() }
  process.exit(0)
}

const runtime = join(resources, 'kb-runtime')
const root = await mkdtemp(join(tmpdir(), 'ak-installed-host-'))
const home = join(root, 'home')
const requests = []
const checks = []
let holdNext = false
let heldResponse
let ctx
let fiber
let service

function check(condition, label) {
  assert.ok(condition, label)
  checks.push(label)
}
async function rejects(operation, label) {
  let refused = false
  try { await operation() } catch { refused = true }
  check(refused, label)
}
async function until(predicate, label) {
  const end = Date.now() + 10_000
  while (Date.now() < end) {
    if (predicate()) return
    await new Promise(resolveWait => setTimeout(resolveWait, 25))
  }
  throw new Error(`Bounded wait expired: ${label}`)
}
const server = createServer(async (request, response) => {
  try {
    let body = ''
    for await (const bytes of request) {
      body += bytes
      if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error('Unexpected oversized fake-provider request')
    }
    const decoded = JSON.parse(body)
    requests.push(decoded)
    const proposal = { operations: [{ op: 'append_log', path: 'wiki/LOG.md',
      entry: `- INSTALLED_APPROVED_CHUNK_${requests.length}`, rationale: 'Synthetic recorded source fact', confidence: 1 }] }
    const send = () => {
      if (response.destroyed) return
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ model: 'installed-recording-model', choices: [{ message: { role: 'assistant', content: JSON.stringify(proposal) }, finish_reason: 'stop' }], usage: { prompt_tokens: 31, completion_tokens: 7 } }))
    }
    if (holdNext) { holdNext = false; heldResponse = send } else send()
  } catch (error) {
    response.writeHead(500)
    response.end(String(error))
  }
})
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
const address = server.address()
assert.ok(address && typeof address === 'object')

async function boot() {
  ctx = new Context()
  ctx.provide('systemPrompt', { getSectionOrder: () => 0, section: () => () => {}, tools: () => () => {} })
  await installToolServices(ctx, home)
  // Deliberate synthetic credential: no personal profile or real provider is read.
  ctx.provide('credentials', { resolve: async () => ({ value: 'synthetic-installed-only' }) })
  fiber = ctx.plugin(DesktopAskKnowledge, { knowledgeHome: home, sidecarRuntimePath: runtime,
    extractionChunkChars: 4000, extractionOutputTokens: 512 })
  await fiber.await()
  service = ctx.get('askKnowledge')
  assert.ok(service && typeof service.remoteDocuments === 'function' && typeof service.remoteDocumentAction === 'function', 'Installed document actions are missing')
}
async function shutdown() {
  if (fiber) await fiber.dispose()
  if (ctx) await ctx.fiber.dispose()
  fiber = undefined
  ctx = undefined
}
async function upload(libraryId, filename, source) {
  const handle = await service.beginIngest({ libraryId, filename })
  const bytes = Buffer.from(source)
  for (let start = 0; start < bytes.length; start += 32_000) {
    await service.appendIngestChunk({ handle, bytes: bytes.subarray(start, start + 32_000).toString('base64') })
  }
  return await service.finishIngest({ handle })
}
function action(document, operation, overrides = {}) {
  return service.remoteDocumentAction({ libraryId: document.libraryId, documentId: document.id, action: operation,
    planHash: document.planHash, approvedTokens: document.estimatedTokens, ...overrides })
}

try {
  const frozenSidecar = join(runtime, 'octopus-kb-sidecar', process.platform === 'win32' ? 'octopus-kb-sidecar.exe' : 'octopus-kb-sidecar')
  for (const encoding of ['ascii', 'cp1252']) {
    // Set the child's encoding directly: the production runner intentionally
    // removes inherited environment overrides before launching its children.
    const wire = spawnSync(frozenSidecar, [], {
      input: JSON.stringify({ command: '不存在命令' }) + '\n', encoding: 'utf8', timeout: 15000,
      env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, TEMP: root, TMP: root,
        SystemRoot: process.env.SystemRoot, PYTHONIOENCODING: encoding, OCTOPUS_KB_ROOT: runtime },
    })
    if (wire.error) throw wire.error
    check(wire.status === 2, `frozen UTF-8 JSON wire returns the expected refusal under ${encoding}`)
    const refusal = JSON.parse(wire.stdout)
    assert.deepEqual(refusal, { ok: false, error: 'unknown command: 不存在命令' })
    check(refusal.error === 'unknown command: 不存在命令', `frozen Unicode JSON refusal remains exact under ${encoding}`)
  }
  await boot()
  const library = await service.createLibrary({ displayName: 'Installed synthetic acceptance' })
  const vault = join(home, 'knowledge-bases', 'libraries', library.id)
  await writeFile(join(vault, '.octopus-kb', 'config.toml'), `version = 1\n[llm]\ndefault_profile = "recording"\n[llm.profiles.recording]\nbase_url = "http://127.0.0.1:${address.port}/v1"\nmodel = "installed-recording-model"\napi_key_env = "DEEPSEEK_API_KEY"\nmax_retries = 0\ntimeout = 10\n`)
  const source = '# Installed long source\n' + '社区培训预算必须保留正规凭证。\n'.repeat(1500) + '\nINSTALLED_FINAL_SOURCE_9241\n'
  const first = await upload(library.id, 'same.md', source)
  check(first.status === 'deferred', 'public upload defers inference until explicit approval')
  check(requests.length === 0, 'upload dispatches zero unapproved model calls')
  const [document] = await service.remoteDocuments(library.id)
  check(document && document.totalChunks > 3 && document.completedChunks === 0, 'durable full-document manifest is pending')
  check(typeof document.planHash === 'string' && document.estimatedTokens > 0 && !document.budgetApproved, 'pending UI data exposes exact plan and complete estimate')
  check(document.originalAvailable && document.searchable, 'status reports actual retained and searchable source')
  const original = await ctx.get('askKnowledgeDocuments').readOriginal(library.id, document.revisionId)
  check(Buffer.from(original.bytes).equals(Buffer.from(source)), 'installed Host retains byte-identical original')
  await rejects(() => action(document, 'approve', { planHash: 'deliberately-wrong-plan' }), 'changed-plan approval is refused')
  await rejects(() => action(document, 'approve', { approvedTokens: 1 }), 'inadequate complete-job allowance is refused')
  check(requests.length === 0, 'invalid approvals dispatch no provider calls')
  await action(document, 'approve')
  const completed = (await service.remoteDocuments(library.id)).find(row => row.id === document.id)
  check(completed.status === 'completed' && completed.completedChunks === completed.totalChunks, 'public approval completes every planned primary span')
  check(requests.length === completed.totalChunks, 'provider observes exactly one call for every manifest chunk')
  check(JSON.stringify(requests).includes('INSTALLED_FINAL_SOURCE_9241'), 'provider observes final source marker beyond old prefix limit')
  check(requests.every(request => request.model === 'installed-recording-model'), 'provider receives the configured model route')
  const storedPlan = JSON.parse(await readFile(join(vault, '.octopus-kb', 'document-plans', createHash('sha256').update(document.id).digest('hex') + '.json'), 'utf8'))
  check(storedPlan.tokensUsed === requests.length * 38, 'actual provider-reported token usage is retained without estimates')
  check(storedPlan.chunks[0].start === 0 && storedPlan.chunks.at(-1).end === source.length && storedPlan.chunks.every((chunk, index) => index === 0 || chunk.start === storedPlan.chunks[index - 1].end), 'durable primary spans cover the full original converted text contiguously')
  const wikiPath = join(vault, 'wiki', 'LOG.md')
  const wiki = await readFile(wikiPath, 'utf8')
  check(wiki.includes(`INSTALLED_APPROVED_CHUNK_${requests.length}`), 'actual provider proposals produce durable wiki effects')
  const callsBeforeRestart = requests.length
  await shutdown()
  await boot()
  const restored = (await service.remoteDocuments(library.id)).find(row => row.id === document.id)
  check(restored.status === 'completed', 'cold Host restart restores completed document state')
  await action(restored, 'approve')
  check(requests.length === callsBeforeRestart, 'completed approval after restart repeats no paid effects')
  check(await readFile(wikiPath, 'utf8') === wiki, 'cold replay repeats no wiki publication')
  const secondSource = '# Distinct same name\nINSTALLED_SECOND_SOURCE_9241\n'
  await upload(library.id, 'same.md', secondSource)
  const documents = await service.remoteDocuments(library.id)
  const second = documents.find(row => row.id !== document.id)
  check(documents.length === 2 && second && second.id !== document.id, 'same-filename upload creates a distinct source identity')
  const raw = await Promise.all((await readdir(join(vault, 'raw'))).map(name => readFile(join(vault, 'raw', name), 'utf8')))
  check(raw.some(text => text.includes('INSTALLED_FINAL_SOURCE_9241')) && raw.some(text => text.includes('INSTALLED_SECOND_SOURCE_9241')), 'both same-name searchable raw sources survive')
  const found = await searchLibraryPassages({ knowledgeHome: home, sidecarRuntimePath: runtime }, home, { libraryId: library.id, queries: ['INSTALLED_FINAL_SOURCE_9241'] })
  check(found.items.some(item => item.text.includes('INSTALLED_FINAL_SOURCE_9241')), 'installed Host search finds the late retained fact')
  check(found.items.some(item => item.path.includes(document.id)), 'late search passage retains immutable source attribution')
  holdNext = true
  const beforeCancel = requests.length
  const running = action(second, 'approve')
  const outcome = running.then(() => 'completed', () => 'rejected')
  await until(() => requests.length > beforeCancel, 'running provider request')
  await action(second, 'cancel')
  check(await outcome === 'rejected', 'public cancel aborts the running owned inference')
  heldResponse?.()
  const cancelled = (await service.remoteDocuments(library.id)).find(row => row.id === second.id)
  check(cancelled.status === 'cancelled', 'cancel action persists terminal state')
  const callsAtCancel = requests.length
  await shutdown()
  await boot()
  const cancelledAfterRestart = (await service.remoteDocuments(library.id)).find(row => row.id === second.id)
  check(cancelledAfterRestart.status === 'cancelled', 'cold restart preserves cancellation')
  await rejects(() => action(cancelledAfterRestart, 'approve'), 'cancelled document cannot silently resume paid work')
  check(requests.length === callsAtCancel, 'cancelled replay issues no provider calls')
  const previewSource = '本会话文档的长文本内容。'.repeat(100_000)
  const extractHandle = await service.beginExtract({ filename: 'long-session.md' })
  const previewBytes = Buffer.from(previewSource)
  for (let start = 0; start < previewBytes.length; start += 32_000) {
    await service.appendExtractChunk({ handle: extractHandle, bytes: previewBytes.subarray(start, start + 32_000).toString('base64') })
  }
  const preview = await service.finishExtract({ handle: extractHandle })
  check(preview.truncated && preview.text.length <= 32_000, 'large session-only conversion uses file results and preserves preview cap')
  const callsBeforePdf = requests.length
  const pdfFixture = name => readFile(new URL(`../packages/experimental/desktop-ask-knowledge/tests/fixtures/conversion/${name}`, import.meta.url))
  const latinBytes = await pdfFixture('latin.pdf')
  const latin = await upload(library.id, 'installed-latin.pdf', latinBytes)
  const latinDocument = (await service.remoteDocuments(library.id)).find(row => row.filename === 'installed-latin.pdf')
  check(latin.status === 'deferred', `installed public text PDF conversion defers approved enrichment (${latin.status}: ${latin.error ?? ''})`)
  check(latinDocument?.conversionStatus === 'complete' && latinDocument.originalAvailable && latinDocument.searchable,
    'installed text PDF reports complete retained and searchable conversion')
  const latinOriginal = await ctx.get('askKnowledgeDocuments').readOriginal(library.id, latinDocument.revisionId)
  check(Buffer.from(latinOriginal.bytes).equals(latinBytes), 'installed text PDF retains original bytes')
  const latinHits = await searchLibraryPassages({ knowledgeHome: home, sidecarRuntimePath: runtime }, home,
    { libraryId: library.id, queries: ['Budget'], documentFilter: latin.rawRelPath })
  check(latinHits.items.some(item => item.text.includes('Community Training Plan') && item.text.includes('Budget 2000 dollars')),
    'installed public text PDF exposes actual converted text to search')

  const mixedBytes = await pdfFixture('mixed-pages.pdf')
  const mixed = await upload(library.id, 'installed-mixed-pages.pdf', mixedBytes)
  const mixedDocument = (await service.remoteDocuments(library.id)).find(row => row.filename === 'installed-mixed-pages.pdf')
  check(mixed.status === 'deferred' && mixedDocument?.conversionStatus === 'partial',
    'installed mixed PDF preserves searchable partial conversion')
  check(mixedDocument.originalAvailable && mixedDocument.searchable && mixedDocument.needsOcrPage === 2,
    'installed mixed PDF identifies page 2 as needing OCR without discarding extractable text')
  const mixedOriginal = await ctx.get('askKnowledgeDocuments').readOriginal(library.id, mixedDocument.revisionId)
  check(Buffer.from(mixedOriginal.bytes).equals(mixedBytes), 'installed mixed PDF retains original bytes')
  const mixedHits = await searchLibraryPassages({ knowledgeHome: home, sidecarRuntimePath: runtime }, home,
    { libraryId: library.id, queries: ['Community'], documentFilter: mixed.rawRelPath })
  check(mixedHits.items.some(item => item.text.includes('Community Training Plan')),
    'installed mixed PDF exposes its extractable page to search')

  const scanBytes = await pdfFixture('scan.pdf')
  const scan = await upload(library.id, 'installed-scan.pdf', scanBytes)
  const scanDocument = (await service.remoteDocuments(library.id)).find(row => row.filename === 'installed-scan.pdf')
  check(scan.status === 'failed' && scanDocument?.conversionStatus === 'needs_ocr',
    'installed scan reports needs OCR instead of fabricated conversion success')
  check(scanDocument.originalAvailable && !scanDocument.searchable && scanDocument.needsOcrPage === 1,
    'installed scan truthfully retains original without claiming searchable text')
  const scanOriginal = await ctx.get('askKnowledgeDocuments').readOriginal(library.id, scanDocument.revisionId)
  check(Buffer.from(scanOriginal.bytes).equals(scanBytes), 'installed scan retains byte-identical original for later OCR')
  check(requests.length === callsBeforePdf, 'installed PDF conversion dispatches no unapproved model calls')
  if (process.platform === 'win32') {
    await assert.rejects(() => service.beginIngest({ libraryId: library.id, filename: 'policy-native-refusal.pptx' }),
      error => error.code === 'type-unsupported')
    check(!(await service.remoteDocuments(library.id)).some(row => row.filename === 'policy-native-refusal.pptx'),
      'Windows library admission rejects unsupported PPTX before creating a document')
  }
  // Every continuation below comes from rendered model content, not private result.value.
  await writeFile(join(vault, 'wiki', 'InstalledPolicy.md'), '---\ntitle: 培训预算\nrole: concept\n---\n# 培训预算\n\n培训预算摘要由知识页提供，数字需核对原文。\n')
  const session = ctx.sessions.prepare(SessionId('installed-tools-session'))
  ctx.sessions.enter(session); ctx.sessions.announce(session)
  session.append('turn/start', { turn: 1 })
  await service.attach({ libraryId: library.id, sessionId: session.id })
  if (process.platform === 'win32') {
    const bytes = Buffer.from('unavailable native converter fixture')
    const reference = await ctx.attachments.saveFile({ name: 'policy-native-refusal.pptx', data: bytes })
    session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'file', attachment: reference }] }),
      { surfaceOp: 'append' })
    const presentation = modelValue(await tool(ctx, session, 'ask_knowledge_session_document', { filename: reference.name }))
    check(presentation.status === 'unsupported' && presentation.text === '' &&
      presentation.diagnostics.omissions.includes('entire presentation') &&
      presentation.diagnostics.warnings.some(warning => warning.includes('network confinement is not implemented')),
      `Windows session attachment visibly refuses unconfined native presentation conversion: ${JSON.stringify(presentation)}`)
    const originalChunks = []
    for await (const chunk of ctx.attachments.readFileStream(reference)) originalChunks.push(Buffer.from(chunk))
    check(Buffer.concat(originalChunks).equals(bytes), 'Windows native conversion refusal preserves the official original byte-for-byte')
  }
  const wikiResult = modelValue(await tool(ctx, session, 'ask_knowledge_retrieve', { terms: ['培训预算'] }))
  check(wikiResult.items.length > 0 && wikiResult.items.every(item => item.verification === 'unverified-wiki-summary' && item.passageId), 'installed rendered wiki results expose IDs and unverified-summary labels')
  const wikiRead = modelValue(await tool(ctx, session, 'ask_knowledge_read', { passageId: wikiResult.items[0].passageId, wikiAttemptId: wikiResult.wikiAttemptId }))
  check(wikiRead.verification === 'unverified-wiki-summary', 'installed wiki read cannot certify a summary as original-source evidence')
  const originalResult = modelValue(await tool(ctx, session, 'ask_knowledge_retrieve', { terms: ['培训预算'], mode: 'source', wikiAttemptId: wikiResult.wikiAttemptId }))
  check(originalResult.items.some(item => item.verification === 'source-verified' && item.sourceRevision && Number.isInteger(item.sourceStart)), 'installed source results carry revision and span evidence')
  for (const item of originalResult.items.filter(item => item.path.startsWith('raw/'))) {
    const raw = await readFile(join(vault, item.path))
    check(item.sourceRevision === 'sha256:' + createHash('sha256').update(raw).digest('hex') &&
      [...raw.toString('utf8')].slice(item.sourceStart, item.sourceEnd).join('') === item.text,
      'installed source evidence locates the exact excerpt in its full revision')
  }
  const offsetText = '# Intro\n' + '😀中前言'.repeat(400) + '\n# Late fact\nOFFSET4471\n'
  const offsetUpload = await upload(library.id, 'offset-evidence.md', offsetText)
  const offsetResult = modelValue(await tool(ctx, session, 'ask_knowledge_retrieve', {
    terms: ['OFFSET4471'], mode: 'source', wikiAttemptId: wikiResult.wikiAttemptId,
  }))
  const offsetHit = offsetResult.items.find(item => item.path === offsetUpload.rawRelPath)
  check(offsetHit && offsetHit.sourceStart > 1000 && [...offsetText].slice(offsetHit.sourceStart, offsetHit.sourceEnd).join('') === offsetHit.text,
    'installed nonzero Unicode source offsets are revision-relative')
  const offsetRead = modelValue(await tool(ctx, session, 'ask_knowledge_read', { passageId: offsetHit.passageId, wikiAttemptId: wikiResult.wikiAttemptId }))
  check(offsetRead.sourceStart > 1000 && [...offsetText].slice(offsetRead.sourceStart, offsetRead.sourceEnd).join('') === offsetRead.text,
    'installed source read returns exact revision-relative spans')
  await upload(library.id, 'cancelled-conversion.docx', Buffer.from('invalid zip')).catch(error => ({ status: 'failed', error: String(error) }))
  const orphanDocument = (await service.remoteDocuments(library.id)).find(row => row.filename === 'cancelled-conversion.docx')
  check(orphanDocument?.stage === 'conversion' && !orphanDocument.searchable, 'installed invalid original is retained as an unsearchable conversion failure')
  await service.remoteDocumentAction({ libraryId: library.id, documentId: orphanDocument.id, action: 'cancel' })
  const orphanPath = join(vault, 'raw', `${orphanDocument.id}-${orphanDocument.revisionId}.md`)
  await writeFile(orphanPath, '# Cancelled conversion\nCANCEL4471\n')
  const orphanResult = modelValue(await tool(ctx, session, 'ask_knowledge_retrieve', {
    terms: ['CANCEL4471'], mode: 'source', wikiAttemptId: wikiResult.wikiAttemptId,
  }))
  check(orphanResult.items.length === 0 && (await service.remoteDocuments(library.id)).find(row => row.id === orphanDocument.id).searchable === false,
    'installed automatic indexing excludes a cancelled conversion orphan while retaining its file')

  check((await tool(ctx, session, 'ask_knowledge_retrieve', { terms: ['培训预算'], mode: 'source', wikiAttemptId: 'forged' })).isError, 'installed source guard rejects forged receipts')
  const unlogged = ctx.sessions.prepare(SessionId('installed-unlogged-session'))
  ctx.sessions.enter(unlogged); ctx.sessions.announce(unlogged); unlogged.append('turn/start', { turn: 1 })
  await service.attach({ libraryId: library.id, sessionId: unlogged.id })
  const unpublishedWiki = modelValue(await tool(ctx, unlogged, 'ask_knowledge_retrieve', { terms: ['培训预算'] }, false))
  check((await tool(ctx, unlogged, 'ask_knowledge_retrieve', { terms: ['培训预算'], mode: 'source', wikiAttemptId: unpublishedWiki.wikiAttemptId })).isError, 'installed source guard rejects unlogged wiki attempts')
  const longText = '会话附件原文说明。'.repeat(5000) + '\nFINAL_ATTACHMENT_EXCEPTION_5172'
  const attachment = await ctx.attachments.saveFile({ name: 'installed-session-long.txt', data: Buffer.from(longText) })
  session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'file', attachment }] }), { surfaceOp: 'append' })
  let cursor, reconstructed = '', pages = 0
  do {
    const result = await tool(ctx, session, 'ask_knowledge_session_document', { filename: attachment.name, action: 'read', ...cursor ? { cursor } : {} })
    check(Buffer.byteLength(JSON.stringify(result.content)) <= 6000, `installed attachment page ${++pages} respects complete rendered-byte allowance`)
    const page = modelValue(result)
    check(page.status === 'complete' && page.diagnostics && !page.page, `installed attachment page ${pages} preserves status and does not invent pagination`)
    reconstructed += page.text; cursor = page.cursor
    assert.ok(pages < 200)
  } while (cursor)
  check(reconstructed === longText && reconstructed.includes('FINAL_ATTACHMENT_EXCEPTION_5172'), 'installed model-visible cursors reconstruct the entire attachment beyond 32000 characters')
  check((await tool(ctx, unlogged, 'ask_knowledge_session_document', { digest: String(attachment.attachmentId) })).isError, 'installed official attachment refuses a cross-session digest')
  const seedPath = join(root, 'session-tool-recovery.json')
  await writeFile(seedPath, JSON.stringify({ id: session.id, events: session.snapshotEvents(), receipt: wikiResult.wikiAttemptId, textHash: createHash('sha256').update(longText).digest('hex') }))
  const restore = spawnSync(process.execPath, [process.argv[1], resources, '--restore-tools', home, seedPath], { encoding: 'utf8', timeout: 120000, maxBuffer: 512 * 1024 })
  assert.equal(restore.status, 0, restore.stderr + restore.stdout)
  check(JSON.parse(restore.stdout.trim().split('\n').at(-1)).separateProcess, 'a separate installed Node process restores logged receipts and complete official attachments, and refuses a deleted session')
  process.stdout.write(JSON.stringify({ ok: true, mode: 'installed-host', checks: checks.length, providerRequests: requests.length,
    sourceSha256: createHash('sha256').update(source).digest('hex'), verified: checks }) + '\n')
} finally {
  heldResponse?.()
  await shutdown()
  server.closeAllConnections()
  await new Promise(resolveClose => server.close(resolveClose))
  hooks.deregister()
  await rm(root, { recursive: true, force: true })
}
