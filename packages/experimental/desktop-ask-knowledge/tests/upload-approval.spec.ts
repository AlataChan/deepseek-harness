import { describe, it, expect } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import DesktopAskKnowledge from '../src/index.ts'
import { installPythonSidecar } from './helpers/install-sidecar.ts'
import { assertVaultDir, requireLibrary } from '../src/catalog.ts'

type UploadFixture = {
  ak: DesktopAskKnowledge
  lib: Awaited<ReturnType<DesktopAskKnowledge['createLibrary']>>
  vault: string
  requests: unknown[]
  upload: (name: string, text: string) => ReturnType<DesktopAskKnowledge['finishIngest']>
}

async function fixture(fn: (arg: UploadFixture) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'ak-round2-host-'))
  const home = join(root, 'home')
  const runtime = join(root, 'runtime')
  await installPythonSidecar(runtime)
  const requests: unknown[] = []
  const server = createServer(async (req, res) => {
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
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing port')
  const ctx = new Context()
  ctx.provide('systemPrompt', { section: () => () => {} })
  ctx.provide('sessionProjections', { register: () => () => {}, stateOf: () => null })
  const creds = ctx.plugin(LocalCredentialProvider, {
    path: join(root, 'synthetic-credentials.yml'),
    watch: false,
  })
  await creds.await()
  await ctx.credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'synthetic-local-only')
  const fiber = ctx.plugin(DesktopAskKnowledge, {
    knowledgeHome: home,
    sidecarRuntimePath: runtime,
  })
  await fiber.await()
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
    await fiber.dispose()
    await creds.dispose()
    server.closeAllConnections()
    await new Promise<void>(r => server.close(() => { r() }))
    await rm(root, { recursive: true, force: true })
  }
}

describe('public upload approval and source isolation', () => {
  it('does not send inference before a full-manifest spending approval', async () => fixture(async ({ requests, upload }) => {
    await upload('policy.md', '# 政策\n未批准任何预算的文档。')
    expect(requests.length).toBe(0)
  }))

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
  }))

  it('keeps both raw imports when filenames are identical', async () => fixture(async ({ upload, vault }) => {
    await upload('same.md', '# 第一份\nFIRST_SOURCE_9241')
    await upload('same.md', '# 第二份\nSECOND_SOURCE_9241')
    const { readdir, readFile } = await import('node:fs/promises')
    const names = await readdir(join(vault, 'raw'))
    const all = (await Promise.all(names.map((n: string) => readFile(join(vault, 'raw', n), 'utf8')))).join('\n')
    expect(all).toContain('FIRST_SOURCE_9241')
    expect(all).toContain('SECOND_SOURCE_9241')
  }))
})
