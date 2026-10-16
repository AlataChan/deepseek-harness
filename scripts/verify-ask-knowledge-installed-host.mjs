#!/usr/bin/env node
/** Exercise public Host operations using only the installed application runtime. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire, registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const resources = resolve(process.argv[2] ?? '')
if (!process.argv[2] || !existsSync(join(resources, 'harness', 'package.json'))) throw new Error('Installed resources directory is required')
const harnessRequire = createRequire(join(resources, 'harness', 'package.json'))
const insideBundle = path => {
  const rel = relative(resources, path)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Installed product import escaped the bundle: ${path}`)
  return path
}
// Seeded overlays deliberately omit workspace dependencies; use the same installed
// Harness closure for those imports, never a checkout or global npm installation.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context) } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('@deepseek-ai/')) throw error
      return next(pathToFileURL(insideBundle(harnessRequire.resolve(specifier))).href, context)
    }
  },
})
const { Context } = await import(pathToFileURL(insideBundle(harnessRequire.resolve('@deepseek-ai/cordis'))).href)
const modulePath = insideBundle(join(resources, 'profile-plugins', '@deepseek-ai', 'dsh-experimental-desktop-ask-knowledge', 'lib', 'index.js'))
const { default: DesktopAskKnowledge, searchLibraryPassages } = await import(pathToFileURL(modulePath).href)
assert.equal(typeof DesktopAskKnowledge, 'function', 'Installed Host implementation is missing')
assert.equal(typeof searchLibraryPassages, 'function', 'Installed search capability is missing')
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
  ctx.provide('systemPrompt', { section: () => () => {} })
  ctx.provide('sessionProjections', { register: () => () => {}, stateOf: () => null })
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
