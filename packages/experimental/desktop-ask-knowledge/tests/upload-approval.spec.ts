import { describe, it, expect, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createServer, type Server } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import DesktopAskKnowledge from '../src/index.ts'
import { installPythonSidecar } from './helpers/install-sidecar.ts'
import { assertVaultDir, requireLibrary } from '../src/catalog.ts'
import { PROCESS_INTEGRATION_TIMEOUT } from './helpers/process-integration-timeout.ts'

type UploadFixture = {
  ak: DesktopAskKnowledge
  lib: Awaited<ReturnType<DesktopAskKnowledge['createLibrary']>>
  vault: string
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
    await fn({ ak, lib, vault, requests, upload })
  } finally {
    await cleanup()
  }
}

describe('public upload approval and source isolation', () => {
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
