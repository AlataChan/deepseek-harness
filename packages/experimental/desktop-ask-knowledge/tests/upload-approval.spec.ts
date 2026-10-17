import { describe, it, expect, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createServer, type Server } from 'node:http'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import DesktopAskKnowledge from '../src/index.ts'
import { installPythonSidecar } from './helpers/install-sidecar.ts'
import { assertVaultDir, requireLibrary } from '../src/catalog.ts'
import { readSourceOriginal } from '../src/source-store.ts'
import * as conversion from '../src/conversion.ts'
import * as native from '@deepseek-ai/dsh-native-command'
import { PROCESS_INTEGRATION_TIMEOUT } from './helpers/process-integration-timeout.ts'

type UploadFixture = {
  ak: DesktopAskKnowledge
  lib: Awaited<ReturnType<DesktopAskKnowledge['createLibrary']>>
  vault: string
  home: string
  requests: unknown[]
  upload: (name: string, text: string) => ReturnType<DesktopAskKnowledge['finishIngest']>
}

async function fixture(fn: (arg: UploadFixture) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'ak-round2-host-'))
  const lifetime = new AbortController()
  const owned: {
    server?: Server
    disposeFiber?: () => Promise<void>
    disposeCredentials?: () => Promise<void>
  } = {}
  let cleanupRun: Promise<void> | undefined
  const cleanup = () => cleanupRun ??= (async () => {
    lifetime.abort()
    try {
      await owned.disposeFiber?.()
    } finally {
      try {
        await owned.disposeCredentials?.()
      } finally {
        const server = owned.server
        server?.closeAllConnections()
        if (server?.listening) await new Promise<void>(resolve => server.close(() => { resolve() }))
        await rm(root, { recursive: true, force: true })
      }
    }
  })()
  onTestFinished(cleanup, PROCESS_INTEGRATION_TIMEOUT)
  const home = join(root, 'home')
  const runtime = join(root, 'runtime')
  await installPythonSidecar(runtime)
  lifetime.signal.throwIfAborted()
  const requests: unknown[] = []
  const provider = createServer(async (req, res) => {
    let text = ''
    for await (const x of req) text += x
    requests.push(JSON.parse(text))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      id: 'synthetic',
      object: 'chat.completion',
      model: 'synthetic-local-model',
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: JSON.stringify({
            operations: [{
              op: 'append_log',
              path: 'wiki/LOG.md',
              entry: '- recording-provider-' + requests.length,
              rationale: 'recorded fixture',
              confidence: 1,
            }],
          }),
        },
      }],
      usage: { prompt_tokens: 50, completion_tokens: 2, total_tokens: 52 },
    }))
  })
  owned.server = provider
  await new Promise<void>(r => provider.listen(0, '127.0.0.1', r))
  lifetime.signal.throwIfAborted()
  const address = provider.address()
  if (!address || typeof address === 'string') throw new Error('missing port')
  const ctx = new Context()
  ctx.provide('systemPrompt', { section: () => () => {} })
  ctx.provide('sessionProjections', { register: () => () => {}, stateOf: () => null })
  const creds = ctx.plugin(LocalCredentialProvider, {
    path: join(root, 'synthetic-credentials.yml'),
    watch: false,
  })
  owned.disposeCredentials = () => creds.dispose()
  await creds.await()
  lifetime.signal.throwIfAborted()
  await ctx.credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'synthetic-local-only')
  lifetime.signal.throwIfAborted()
  const fiber = ctx.plugin(DesktopAskKnowledge, {
    knowledgeHome: home,
    sidecarRuntimePath: runtime,
  })
  owned.disposeFiber = () => fiber.dispose()
  await fiber.await()
  lifetime.signal.throwIfAborted()
  try {
    const ak = ctx.get('askKnowledge') as DesktopAskKnowledge
    const lib = await ak.createLibrary({ displayName: 'Synthetic review' })
    const vault = await assertVaultDir(home, await requireLibrary(home, lib.id))
    await writeFile(
      join(vault, '.octopus-kb/config.toml'),
      `version = 1
[llm]
default_profile = "test"
[llm.profiles.test]
base_url = "http://127.0.0.1:${address.port}/v1"
model = "synthetic-local-model"
api_key_env = "DEEPSEEK_API_KEY"
max_retries = 0
timeout = 5
`,
    )
    const upload = async (name: string, text: string) => {
      const h = await ak.beginIngest({ libraryId: lib.id, filename: name })
      await ak.appendIngestChunk({ handle: h, bytes: Buffer.from(text).toString('base64') })
      return ak.finishIngest({ handle: h })
    }
    await fn({ ak, lib, vault, home, requests, upload })
  } finally {
    await cleanup()
  }
}

describe('public upload approval and source isolation', () => {
  it('opens a named independent original copy and readable extracted text', async () => fixture(async ({ ak, lib, home, upload }) => {
    const opened: string[] = []
    vi.spyOn(native, 'canOpenNativePath').mockReturnValue(true)
    for (const name of ['openNativePath', 'openNativeAssociatedPath', 'openNativeTextFile'] as const) {
      vi.spyOn(native, name).mockImplementation(async (path) => { opened.push(path) })
    }
    onTestFinished(() => { vi.restoreAllMocks() })
    await upload('Policy original.md', '# Policy\nORIGINAL_BYTES_4471')
    const [document] = await ak.remoteDocuments(lib.id)
    if (!document) throw new Error('missing document')
    await ak.remoteDocumentAction({ libraryId: lib.id, documentId: document.id, action: 'original' })
    expect(opened[0]).toMatch(/Policy original\.md$/)
    expect(await readFile(opened[0]!, 'utf8')).toContain('ORIGINAL_BYTES_4471')
    await writeFile(opened[0]!, 'User edited preview')
    expect(Buffer.from((await readSourceOriginal({ sidecarRuntimePath: join(home, '../runtime') }, home, lib.id, document.revisionId)).bytes).toString()).toContain('ORIGINAL_BYTES_4471')
    await ak.remoteDocumentAction({ libraryId: lib.id, documentId: document.id, action: 'text' })
    expect(opened[1]).toMatch(/\.txt$/)
    expect(await readFile(opened[1]!, 'utf8')).toContain('ORIGINAL_BYTES_4471')
  }), PROCESS_INTEGRATION_TIMEOUT)

  it('opens source information even when conversion failed before a plan existed', async () => fixture(async ({ ak, lib, upload }) => {
    const opened: string[] = []
    vi.spyOn(native, 'canOpenNativePath').mockReturnValue(true)
    for (const name of ['openNativePath', 'openNativeAssociatedPath', 'openNativeTextFile'] as const) {
      vi.spyOn(native, name).mockImplementation(async (path) => { opened.push(path) })
    }
    onTestFinished(() => { vi.restoreAllMocks() })
    await upload('broken.pdf', 'not a PDF')
    const [document] = await ak.remoteDocuments(lib.id)
    if (!document) throw new Error('missing document')
    expect(document.status).toBe('failed')
    await ak.remoteDocumentAction({ libraryId: lib.id, documentId: document.id, action: 'sources' })
    expect(await readFile(opened[0]!, 'utf8')).toContain('broken.pdf')
  }), PROCESS_INTEGRATION_TIMEOUT)

  it('does not let resume grant initial spending approval', async () => fixture(async ({ ak, lib, requests, upload }) => {
    await upload('unapproved.md', '# Not approved\nA source fact')
    const [document] = await ak.remoteDocuments(lib.id)
    if (!document?.planHash) throw new Error('missing document plan')
    const forged: Parameters<DesktopAskKnowledge['remoteDocumentAction']>[0] = JSON.parse(JSON.stringify({
      libraryId: lib.id, documentId: document.id, action: 'unknown-action',
      planHash: document.planHash, approvedTokens: document.estimatedTokens,
    }))
    await expect(ak.remoteDocumentAction(forged)).rejects.toThrow('Unsupported document action')
    await expect(ak.remoteDocumentAction({ libraryId: lib.id, documentId: document.id, action: 'resume',
      planHash: document.planHash, approvedTokens: document.estimatedTokens })).rejects.toThrow(/approv/i)
    expect(requests).toHaveLength(0)
  }), PROCESS_INTEGRATION_TIMEOUT)

  it('reports retry conversion as active and fences cancellation before publication', async () => fixture(async ({ ak, lib, upload }) => {
    await upload('retry-cancel.pdf', 'not a PDF')
    const [document] = await ak.remoteDocuments(lib.id)
    if (!document) throw new Error('missing failed conversion')
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    vi.spyOn(conversion, 'convertSourceFile').mockImplementation(async () => {
      entered.resolve(undefined)
      await release.promise
      return { status: 'complete', format: 'pdf', markdown: 'CANCELLED_RETRY_MUST_NOT_PUBLISH', blocks: [],
        sha256: 'a'.repeat(64), byteLength: 3, diagnostics: { warnings: [], omissions: [], unsupportedFeatures: [] } }
    })
    onTestFinished(() => { vi.restoreAllMocks() })
    const running = ak.remoteDocumentAction({ libraryId: lib.id, documentId: document.id, action: 'retry' })
    const settled = running.catch(() => undefined)
    try {
      await entered.promise
      expect((await ak.remoteDocuments(lib.id))[0]?.status).toBe('active')
      const cancelling = ak.remoteDocumentAction({ libraryId: lib.id, documentId: document.id, action: 'cancel' })
      await vi.waitFor(async () => expect((await ak.remoteDocuments(lib.id))[0]?.status).toBe('cancelled'), { timeout: 10_000 })
      release.resolve(undefined)
      await cancelling
      await expect(running).rejects.toThrow()
      const [cancelled] = await ak.remoteDocuments(lib.id)
      expect(cancelled).toMatchObject({ status: 'cancelled', searchable: false })
      expect(cancelled?.planHash).toBeUndefined()
    } finally { release.resolve(undefined); await settled }
  }), PROCESS_INTEGRATION_TIMEOUT)

  it('persists a thrown retry conversion error and keeps retry available', async () => fixture(async ({ ak, lib, upload }) => {
    await upload('retry-throw.pdf', 'not a PDF')
    const [document] = await ak.remoteDocuments(lib.id)
    if (!document) throw new Error('missing failed conversion')
    vi.spyOn(conversion, 'convertSourceFile').mockRejectedValue(new Error('CONTROLLED_CONVERTER_TIMEOUT_4471'))
    onTestFinished(() => { vi.restoreAllMocks() })
    await expect(ak.remoteDocumentAction({ libraryId: lib.id, documentId: document.id, action: 'retry' })).rejects.toThrow('CONTROLLED_CONVERTER_TIMEOUT_4471')
    expect((await ak.remoteDocuments(lib.id))[0]).toMatchObject({ status: 'failed', stage: 'conversion', error: 'CONTROLLED_CONVERTER_TIMEOUT_4471' })
  }), PROCESS_INTEGRATION_TIMEOUT)

  it('does not send inference before a full-manifest spending approval', async () => fixture(async ({ requests, upload }) => {
    await upload('policy.md', '# 政策\n未批准任何预算的文档。')
    expect(requests.length).toBe(0)
  }), PROCESS_INTEGRATION_TIMEOUT)

  it('delivers the late document content to extraction instead of a prefix', async () => fixture(async ({ ak, lib, requests, upload }) => {
    const pending = await upload('long.md', '# 长文\n' + '背景材料。'.repeat(2600) + '\n末尾唯一事实END_COVERAGE_9241')
    expect(pending.status).toBe('deferred')
    expect(requests).toHaveLength(0)
    const [document] = await ak.remoteDocuments(lib.id)
    if (!document?.planHash) throw new Error('Pending document and spending plan are required')
    expect(document.status).toBe('paused')
    await expect(ak.remoteDocumentAction({
      libraryId: lib.id,
      documentId: document.id,
      action: 'approve',
      planHash: document.planHash,
      approvedTokens: 1,
    })).rejects.toThrow()
    expect(requests).toHaveLength(0)
    await ak.remoteDocumentAction({
      libraryId: lib.id,
      documentId: document.id,
      action: 'approve',
      planHash: document.planHash,
      approvedTokens: document.estimatedTokens,
    })
    expect(requests.length).toBeGreaterThan(0)
    expect(JSON.stringify(requests)).toContain('END_COVERAGE_9241')
  }), PROCESS_INTEGRATION_TIMEOUT)

  it('keeps both raw imports when filenames are identical', async () => fixture(async ({ upload, vault }) => {
    await upload('same.md', '# 第一份\nFIRST_SOURCE_9241')
    await upload('same.md', '# 第二份\nSECOND_SOURCE_9241')
    const { readdir, readFile } = await import('node:fs/promises')
    const names = await readdir(join(vault, 'raw'))
    const all = (await Promise.all(names.map((n: string) => readFile(join(vault, 'raw', n), 'utf8')))).join('\n')
    expect(all).toContain('FIRST_SOURCE_9241')
    expect(all).toContain('SECOND_SOURCE_9241')
  }), PROCESS_INTEGRATION_TIMEOUT)
})
