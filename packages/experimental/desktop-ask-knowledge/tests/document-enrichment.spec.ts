import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { runSidecar, type SidecarRequest, type SidecarResponse } from '../src/sidecar.ts'
import { installPythonSidecar } from './helpers/install-sidecar.ts'
import { PROCESS_INTEGRATION_TIMEOUT } from './helpers/process-integration-timeout.ts'

describe('approved complete document enrichment', () => {
  let home: string
  let vault: string
  let runtime: string
  let server: Server
  let requests: string[]
  let revisionId: string
  let invalidResponseAt: number | undefined
  let controller: AbortController
  const activeSidecars = new Set<Promise<SidecarResponse>>()
  const sidecar = (request: SidecarRequest) => {
    const call = runSidecar(config(), request, { signal: controller.signal })
    activeSidecars.add(call)
    void call.then(() => { activeSidecars.delete(call) }, () => { activeSidecars.delete(call) })
    return call
  }
  const source = '社区培训预算须有正规凭证。\n'.repeat(1200) + 'END_OF_DOCUMENT_9241'

  beforeEach(async () => {
    controller = new AbortController()
    home = await mkdtemp(join(tmpdir(), 'ak-approved-enrich-'))
    vault = join(home, 'vault')
    runtime = join(home, 'runtime')
    await mkdir(join(vault, '.octopus-kb'), { recursive: true })
    await mkdir(join(vault, 'raw'), { recursive: true })
    await mkdir(join(vault, 'wiki'), { recursive: true })
    await writeFile(join(vault, 'raw', 'source.md'), source)
    await writeFile(join(vault, 'AGENTS.md'), '---\ntitle: AGENTS\npage_type: schema\nlang: zh\nrole: schema\n---\n# schema\n')
    for (const [name, role] of [['INDEX', 'index'], ['LOG', 'log']]) {
      await writeFile(join(vault, 'wiki', `${name}.md`), `---\ntitle: ${name}\npage_type: ${role}\nlang: zh\nrole: ${role}\n---\n# ${name}\n`)
    }
    requests = []
    invalidResponseAt = undefined
    server = createServer((req, res) => {
      void (async () => {
        const body: Uint8Array[] = []
        for await (const chunk of req) {
          if (!(chunk instanceof Uint8Array)) throw new Error('Recording provider received a non-byte request chunk')
          body.push(chunk)
        }
        const request = Buffer.concat(body).toString()
        requests.push(request)
        // Recording provider returns a real schema-valid model proposal and real usage fields.
        const proposal = { operations: [{ op: 'append_log', path: 'wiki/LOG.md',
          entry: `- approved-extraction-${requests.length}`, rationale: 'recorded source fact', confidence: 1 }] }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ model: 'recording-model', choices: [{ message: { content: requests.length === invalidResponseAt ? 'invalid recorded proposal' : JSON.stringify(proposal) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 31, completion_tokens: 7 } }))
      })().catch((error: unknown) => { res.destroy(error instanceof Error ? error : new Error(String(error))) })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Recording provider did not bind')
    await writeFile(join(vault, '.octopus-kb', 'config.toml'), `version = 1\n[llm]\ndefault_profile = "recording"\n[llm.profiles.recording]\nbase_url = "http://127.0.0.1:${address.port}/v1"\nmodel = "recording-model"\nmax_retries = 0\n`)
    await installPythonSidecar(runtime)
    const registered = await sidecar({ command: 'register-source-revision', vault,
      documentId: 'doc-1', libraryId: 'library-1', filename: 'source.md', byteLength: Buffer.byteLength(source),
      sha256: createHash('sha256').update(source).digest('hex'), objectPath: 'raw/source.md' })
    const revision = registered.revision
    if (!revision || typeof revision !== 'object' || !('revisionId' in revision) || typeof revision.revisionId !== 'string') {
      throw new Error('No source revision was registered')
    }
    revisionId = revision.revisionId
  }, PROCESS_INTEGRATION_TIMEOUT)

  afterEach(async () => {
    controller.abort()
    while (activeSidecars.size > 0) await Promise.allSettled([...activeSidecars])
    server?.closeAllConnections()
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => {
      if (error) reject(error)
      else resolve()
    }))
    await rm(home, { recursive: true, force: true })
  }, PROCESS_INTEGRATION_TIMEOUT)

  const config = () => ({ sidecarRuntimePath: runtime })
  const plan = () => sidecar({ command: 'plan-document', vault, libraryId: 'library-1',
    documentId: 'doc-1', revisionId, rawPath: 'raw/source.md', chunkChars: 4000 })

  it('plans every character without inference and rejects an inadequate approval', async () => {
    const pending = await plan()
    expect(pending.status).toBe('awaiting_approval')
    expect(pending.totalChunks).toBeGreaterThan(3)
    expect(requests).toHaveLength(0)
    await expect(sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: 1 })).rejects.toThrow(/full manifest/)
    expect(requests).toHaveLength(0)
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('uses actual provider replies and covers the final chunk exactly once across reboot', async () => {
    const pending = await plan()
    const request = { command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate }
    const result = await sidecar(request)
    expect(result.status).toBe('completed')
    expect(requests).toHaveLength(Number(pending.totalChunks))
    expect(requests.join('\n')).toContain('END_OF_DOCUMENT_9241')
    for (const body of requests) expect(JSON.parse(body)).toMatchObject({ response_format: { type: 'json_object' } })
    expect(result.tokensUsed).toBe(requests.length * 38)
    const log = await readFile(join(vault, 'wiki', 'LOG.md'), 'utf8')
    expect(log).toContain(`approved-extraction-${requests.length}`)
    const calls = requests.length
    await sidecar({ command: 'increment-startup-attempt', vault, libraryId: 'library-1' })
    expect((await sidecar(request)).status).toBe('completed')
    expect(requests).toHaveLength(calls)
    expect(await readFile(join(vault, 'wiki', 'LOG.md'), 'utf8')).toBe(log)
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('requires a fresh approval for retry and preserves already committed chunks', async () => {
    const pending = await plan()
    invalidResponseAt = 2
    await expect(sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate })).rejects.toThrow()
    expect(requests).toHaveLength(2)
    const interrupted = await sidecar({ command: 'get-job', vault, jobId: pending.jobId })
    const recordedJob = interrupted.job
    expect(recordedJob).toMatchObject({ tokensUsed: 76 })
    expect(await readFile(join(vault, '.octopus-kb', 'document-plans', 'manifests', `${String(pending.planHash)}.json`), 'utf8'))
      .toContain('END_OF_DOCUMENT_9241')
    const logBeforeRetry = await readFile(join(vault, 'wiki', 'LOG.md'), 'utf8')
    expect(logBeforeRetry).toContain('approved-extraction-1')
    const retry = await sidecar({ command: 'document-action', vault, libraryId: 'library-1',
      documentId: 'doc-1', action: 'retry' })
    expect(retry.planHash).not.toBe(pending.planHash)
    expect(retry.status).toBe('awaiting_approval')
    expect(requests).toHaveLength(2)
    invalidResponseAt = undefined
    const finished = await sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: retry.planHash, approvedTokens: retry.tokenEstimate })
    expect(finished.status).toBe('completed')
    expect(requests).toHaveLength(Number(pending.totalChunks) + 1)
    const log = await readFile(join(vault, 'wiki', 'LOG.md'), 'utf8')
    expect(log.match(/approved-extraction-1\b/g)).toHaveLength(1)
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('refuses the former synthetic enrichment entry and cancelled jobs', async () => {
    const pending = await plan()
    await expect(sidecar({ command: 'enrich-chunks', vault, libraryId: 'library-1', documentId: 'doc-1',
      revisionId, jobId: pending.jobId, expectedStartupAttempt: 1, chunks: [{ primaryText: source }],
    })).rejects.toThrow(/Unapproved enrichment/)
    await sidecar({ command: 'document-action', action: 'cancel', vault, libraryId: 'library-1', documentId: 'doc-1' })
    await expect(sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate })).rejects.toThrow(/Cancelled/)
    expect(requests).toHaveLength(0)
  }, PROCESS_INTEGRATION_TIMEOUT)
})
