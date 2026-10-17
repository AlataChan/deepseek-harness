import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  let customResponder: ((reqIndex: number, requestBody: string) => { content: string; finishReason?: string } | undefined) | undefined
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
      await writeFile(join(vault, 'wiki', `${name}.md`),
        `---\ntitle: ${name}\npage_type: ${role}\nlang: zh\nrole: ${role}\n---\n# ${name}\n`)
    }
    requests = []
    invalidResponseAt = undefined
    customResponder = undefined
    server = createServer((req, res) => {
      void (async () => {
        const body: Uint8Array[] = []
        for await (const chunk of req) {
          if (!(chunk instanceof Uint8Array)) throw new Error('Recording provider received a non-byte request chunk')
          body.push(chunk)
        }
        const request = Buffer.concat(body).toString()
        requests.push(request)
        const custom = customResponder ? customResponder(requests.length, request) : undefined
        // Recording provider returns a real schema-valid model proposal and real usage fields.
        const defaultProposal = { operations: [{ op: 'append_log', path: 'wiki/LOG.md',
          entry: `- approved-extraction-${requests.length}`, rationale: 'recorded source fact', confidence: 1 }] }
        const content = custom ? custom.content : (requests.length === invalidResponseAt ? 'invalid recorded proposal' : JSON.stringify(defaultProposal))
        const finishReason = custom?.finishReason ?? 'stop'
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ model: 'recording-model', choices: [{ message: { content }, finish_reason: finishReason }],
          usage: { prompt_tokens: 31, completion_tokens: 7 } }))
      })().catch((error: unknown) => { res.destroy(error instanceof Error ? error : new Error(String(error))) })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Recording provider did not bind')
    await writeFile(join(vault, '.octopus-kb', 'config.toml'),
      `version = 1\n[llm]\ndefault_profile = "recording"\n[llm.profiles.recording]\nbase_url = "http://127.0.0.1:${address.port}/v1"\nmodel = "recording-model"\nmax_retries = 0\n`)
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

  it('rejects invalid saved-reply Resume, retries only pending work and retires the old job', async () => {
    const pending = await plan()
    invalidResponseAt = 3
    const execute = { command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate }
    await expect(sidecar(execute)).rejects.toThrow()
    const before = requests.length
    await expect(sidecar({ ...execute, requireExistingApproval: true })).rejects.toThrow(/explicitly Retry/)
    expect(requests).toHaveLength(before)
    const retry = await sidecar({ command: 'document-action', vault, libraryId: 'library-1', documentId: 'doc-1', action: 'retry' })
    expect(retry.completedChunks).toBe(2)
    expect(Number(retry.tokenEstimate)).toBeLessThan(Number(pending.tokenEstimate))
    const oldJob = await sidecar({ command: 'get-job', vault, jobId: pending.jobId })
    expect(oldJob.job).toMatchObject({ status: 'cancelled' })
    const result = await sidecar({ ...execute, expectedPlanHash: retry.planHash, approvedTokens: retry.tokenEstimate })
    expect(result.status).toBe('completed')
    expect(requests.length - before).toBe(Number(pending.totalChunks) - 2)
    expect(result.tokensUsed).toBe(requests.length * 38)
    const completedRetry = await sidecar({ command: 'document-action', vault, libraryId: 'library-1', documentId: 'doc-1', action: 'retry' })
    expect(completedRetry.status).toBe('completed')
    expect(completedRetry.planHash).toBe(retry.planHash)
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('checkpoints a one-chunk batch so the Host can continue under a fresh deadline', async () => {
    const pending = await plan()
    const execute = { command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate, maxChunks: 1 }
    let result = await sidecar(execute)
    expect(result.status).toBe('queued')
    expect(result.completedChunks).toBe(1)
    expect(requests).toHaveLength(1)
    while (result.status === 'queued') result = await sidecar({ ...execute, requireExistingApproval: true })
    expect(result.status).toBe('completed')
    expect(requests.length).toBe(pending.totalChunks)
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('marks bounded wiki context as partial and excludes processing logs from synthesis', async () => {
    await writeFile(join(vault, 'wiki', 'Policy.md'), '---\ntitle: 社区培训\ntype: note\nrole: note\nlayer: wiki\nlang: zh\nsummary: Policy\n---\n' + '人工核验规则。'.repeat(2000))
    await writeFile(join(vault, 'wiki', 'LOG.md'), '# LOG\nFALSE_TRUNCATION_FROM_LOG_4481')
    const pending = await plan()
    await sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate, maxChunks: 1 })
    const prompt = JSON.parse(requests[0]!).messages[0].content as string
    expect(prompt).toContain('not the full wiki')
    expect(prompt).toContain('"truncated":true')
    expect(prompt).not.toContain('FALSE_TRUNCATION_FROM_LOG_4481')
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('reduces fresh-plan request overhead with larger excerpts without treating the ceiling as billed usage', async () => {
    const small = await sidecar({ command: 'plan-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      revisionId, rawPath: 'raw/source.md', chunkChars: 1500, outputReserve: 2048 })
    const larger = await sidecar({ command: 'plan-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      revisionId, rawPath: 'raw/source.md', chunkChars: 6000, outputReserve: 4096 })
    expect(Number(larger.tokenEstimate)).toBeLessThan(Number(small.tokenEstimate) * 0.6)
    expect(larger.tokensUsed).toBe(0)
    expect(larger.budgetApproved).toBe(false)
    expect(requests).toHaveLength(0)
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('requires approval parameters on the public sidecar Resume instead of raising KeyError', async () => {
    await plan()
    await expect(sidecar({ command: 'document-action', vault, libraryId: 'library-1', documentId: 'doc-1', action: 'resume' }))
      .rejects.toThrow(/Expected plan hash and explicit approved token allowance/)
    expect(requests).toHaveLength(0)
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('explicit output-limit Retry increases the reserve and still requires a new approval', async () => {
    const pending = await plan()
    customResponder = () => ({ content: '{}', finishReason: 'length' })
    await expect(sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate })).rejects.toThrow(/output limit/)
    const retry = await sidecar({ command: 'document-action', vault, libraryId: 'library-1', documentId: 'doc-1', action: 'retry' })
    expect(retry.budgetApproved).toBe(false)
    expect(requests).toHaveLength(1)
    customResponder = undefined
    await sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: retry.planHash, approvedTokens: retry.tokenEstimate, maxChunks: 1 })
    expect(JSON.parse(requests[1]!).max_tokens).toBe(JSON.parse(requests[0]!).max_tokens * 2)
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('publishes cited create_page, add_alias and the reported append_log together', async () => {
    const reported = JSON.parse(await readFile(new URL('./fixtures/append-log-with-source-span.json', import.meta.url), 'utf8'))
    const pending = await plan()
    customResponder = index => index === 1 ? { content: JSON.stringify({ operations: [
      { op: 'create_page', path: 'wiki/CitedPolicy.md',
        frontmatter: { title: 'CitedPolicy', type: 'note', role: 'note', layer: 'wiki', lang: 'zh', summary: '培训要求' },
        body: '社区培训预算须有正规凭证。', rationale: 'source fact', confidence: 1,
        source_span: { path: 'raw/source.md', start_line: 1, end_line: 5 } },
      { op: 'add_alias', target_page: 'wiki/CitedPolicy.md', alias: '培训凭证', rationale: 'source alias', confidence: 1,
        source_span: { path: 'raw/source.md', start_line: 1, end_line: 5 } },
      { ...reported, source_span: { ...reported.source_span, path: 'raw/source.md' } },
    ] }) } : undefined
    const execute = { command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate }
    const result = await sidecar(execute)
    expect(result.status).toBe('completed')
    expect(await readFile(join(vault, 'wiki', 'CitedPolicy.md'), 'utf8')).toContain('培训凭证')
    const log = await readFile(join(vault, 'wiki', 'LOG.md'), 'utf8')
    expect(log).toContain(reported.entry)
    const checkpointPath = join(vault, '.octopus-kb', 'document-plans', `${String(pending.planHash)}-0.json`)
    const saved = JSON.parse(await readFile(checkpointPath, 'utf8'))
    expect(saved.proposal.operations[2].source_span).toEqual({ path: 'raw/source.md', start_line: 38, end_line: 66 })
    const count = requests.length
    expect((await sidecar(execute)).status).toBe('completed')
    expect(requests).toHaveLength(count)
    expect(await readFile(join(vault, 'wiki', 'LOG.md'), 'utf8')).toBe(log)
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('resumes a log citation rejected by the old schema without repeating its paid call', async () => {
    await cp(new URL('../python/kb/src/', import.meta.url), join(runtime, 'src'), { recursive: true })
    await cp(new URL('../python/kb/prompts/', import.meta.url), join(runtime, 'prompts'), { recursive: true })
    await cp(new URL('../python/kb/schemas/', import.meta.url), join(runtime, 'schemas'), { recursive: true })
    const schemaPath = join(runtime, 'schemas', 'llm', 'proposal.json')
    const currentSchema = await readFile(schemaPath, 'utf8')
    const legacySchema = JSON.parse(currentSchema)
    delete legacySchema.$defs.append_log_op.properties.source_span
    await writeFile(schemaPath, JSON.stringify(legacySchema))
    const reported = JSON.parse(await readFile(new URL('./fixtures/append-log-with-source-span.json', import.meta.url), 'utf8'))
    const pending = await plan()
    customResponder = index => index === 1 ? { content: JSON.stringify({ operations: [
      { ...reported, source_span: { ...reported.source_span, path: 'raw/source.md' } },
    ] }) } : undefined
    const execute = { command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate }
    await expect(sidecar(execute)).rejects.toThrow(/Provider proposal rejected/)
    expect(requests).toHaveLength(1)
    const checkpointPath = join(vault, '.octopus-kb', 'document-plans', `${String(pending.planHash)}-0.json`)
    const before = JSON.parse(await readFile(checkpointPath, 'utf8'))
    expect(before.state).toBe('response')
    await writeFile(schemaPath, currentSchema)
    const result = await sidecar(execute)
    expect(result.status).toBe('completed')
    expect(result.tokensUsed).toBe(Number(pending.totalChunks) * 38)
    expect(requests).toHaveLength(Number(pending.totalChunks))
    const after = JSON.parse(await readFile(checkpointPath, 'utf8'))
    expect(after.attemptId).toBe(before.attemptId)
    expect(after.content).toBe(before.content)
    expect(after.proposal.operations[0].source_span).toEqual({ path: 'raw/source.md', start_line: 38, end_line: 66 })
    expect(await readFile(join(vault, 'wiki', 'LOG.md'), 'utf8')).toContain(reported.entry)
  }, PROCESS_INTEGRATION_TIMEOUT)

  it.each(['create_page', 'add_alias', 'append_log'])(
    'still rejects foreign and out-of-range citations on %s', async (op) => {
      const pending = await plan()
      const operation = {
        create_page: { op, path: 'wiki/Rejected.md',
          frontmatter: { title: 'Rejected', type: 'note', role: 'note', layer: 'wiki', lang: 'zh', summary: '培训要求' },
          body: '不得发布' },
        add_alias: { op, target_page: 'wiki/INDEX.md', alias: '不得发布' },
        append_log: { op, path: 'wiki/LOG.md', entry: '不得发布' },
      }[op]
      customResponder = () => ({ content: JSON.stringify({ operations: [{ ...operation, rationale: 'invalid citation', confidence: 1,
        source_span: { path: 'raw/foreign.md', start_line: 1, end_line: 5 } }] }) })
      const execute = { command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
        expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate }
      await expect(sidecar(execute)).rejects.toThrow(/outside the approved primary source range/)
      expect(requests).toHaveLength(1)
      const checkpointPath = join(vault, '.octopus-kb', 'document-plans', `${String(pending.planHash)}-0.json`)
      const saved = JSON.parse(await readFile(checkpointPath, 'utf8'))
      const payload = JSON.parse(saved.content)
      payload.operations[0].source_span = { path: 'raw/source.md', start_line: 9999, end_line: 10000 }
      saved.content = JSON.stringify(payload)
      await writeFile(checkpointPath, JSON.stringify(saved))
      await expect(sidecar(execute)).rejects.toThrow(/outside the approved primary source range/)
      expect(requests).toHaveLength(1)
      expect(await readFile(join(vault, 'wiki', 'LOG.md'), 'utf8')).not.toContain('不得发布')
    }, PROCESS_INTEGRATION_TIMEOUT,
  )

  it('durably queues admission without inference and pauses an orphaned queue after restart', async () => {
    const pending = await plan()
    const request = { command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate }
    const admitted = await sidecar({ ...request, admitOnly: true })
    expect(admitted.status).toBe('queued')
    expect(admitted.budgetApproved).toBe(true)
    expect(requests).toHaveLength(0)
    await sidecar({ command: 'increment-startup-attempt', vault, libraryId: 'library-1' })
    const staleFailure = await sidecar({ command: 'document-action', vault, libraryId: 'library-1', documentId: 'doc-1',
      action: 'pause', expectedPlanHash: pending.planHash, expectedStartupAttempt: admitted.startupAttempt,
      error: 'STALE_BACKGROUND_FAILURE' })
    expect(staleFailure.ignored).toBe(true)
    const status = await sidecar({ command: 'document-status', vault, libraryId: 'library-1' })
    expect(status.documents).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'paused', budgetApproved: true })]))
    expect(requests).toHaveLength(0)
    expect((await sidecar({ ...request, requireExistingApproval: true })).status).toBe('completed')
    expect(requests).toHaveLength(Number(pending.totalChunks))
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('labels every inference input as an excerpt and reports chunks without content pages', async () => {
    const pending = await plan()
    const result = await sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate })
    expect(requests[0]).toContain('EXCERPT 1 OF')
    expect(requests[0]).toContain('Do not infer that the original document is truncated')
    const prompt = JSON.parse(requests[0]!).messages[0].content as string
    const providerSchema = JSON.parse(prompt.split('PROPOSAL SCHEMA:\n')[1]!.split('\n\nOutput')[0]!)
    expect(Object.keys(providerSchema.properties)).toEqual(['operations'])
    expect(prompt.split('\n')[0]).toMatchInlineSnapshot('"EXCERPT 1 OF 5. This is a bounded excerpt, not the whole source. The document may continue before and after this excerpt. Do not infer that the original document is truncated. Summarize only facts supported by this excerpt; do not turn chunk boundaries into document claims."')
    expect(result.chunksWithoutPages).toBe(pending.totalChunks)
    expect(result.wikiReady).toBe(false)
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('refuses append_log against an ordinary content page without changing it', async () => {
    const page = '---\ntitle: Existing\ntype: note\nrole: note\nlang: zh\nlayer: wiki\nsummary: 原文内容\n---\n# Existing\n原文内容。\n'
    await writeFile(join(vault, 'wiki', 'Existing.md'), page)
    const pending = await plan()
    customResponder = () => ({ content: JSON.stringify({ operations: [{ op: 'append_log', path: 'wiki/Existing.md',
      entry: '- 源文件在第3节处截断', rationale: 'wrong log target', confidence: 1 }] }) })
    await expect(sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate })).rejects.toThrow(/proposal rejected/i)
    expect(await readFile(join(vault, 'wiki', 'Existing.md'), 'utf8')).toBe(page)
  }, PROCESS_INTEGRATION_TIMEOUT)

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
    const planPath = join(vault, '.octopus-kb', 'document-plans', createHash('sha256').update('doc-1').digest('hex') + '.json')
    const historical = JSON.parse(await readFile(planPath, 'utf8'))
    historical.error = 'Old publication error from a previous build'
    await writeFile(planPath, JSON.stringify(historical), 'utf8')
    expect((await sidecar(request)).error).toBeUndefined()
    const status = await sidecar({ command: 'document-status', vault, libraryId: 'library-1' })
    expect(status.documents).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'completed' })]))
    expect(JSON.stringify(status.documents)).not.toContain(historical.error)
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('publishes generated policy metadata as a note without weakening page validation', async () => {
    const pending = await plan()
    customResponder = index => index === 1 ? { content: JSON.stringify({ operations: [{
      op: 'create_page', path: 'wiki/TrainingPolicy.md',
      frontmatter: { title: 'TrainingPolicy', type: 'policy', role: 'policy', layer: 'wiki', lang: 'zh', summary: '社区培训预算' },
      body: '社区培训预算须有正规凭证。', rationale: 'source policy', confidence: 1,
      source_span: { path: 'raw/source.md', start_line: 1, end_line: 5 },
    }] }) } : undefined
    const result = await sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate })
    expect(result.status).toBe('completed')
    const page = await readFile(join(vault, 'wiki', 'TrainingPolicy.md'), 'utf8')
    expect(page).toMatch(/type: "note"/)
    expect(page).toMatch(/role: "note"/)
    expect(requests).toHaveLength(Number(pending.totalChunks))
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('repairs a saved prepared response on resume without paying for that range again', async () => {
    const pending = await plan()
    customResponder = index => index === 1 ? { content: JSON.stringify({ operations: [{
      op: 'create_page', path: 'wiki/SavedPolicy.md',
      frontmatter: { title: 'SavedPolicy', type: 'note', role: 'note', layer: 'wiki', lang: 'z', summary: '社区培训预算' },
      body: '社区培训预算须有正规凭证。', rationale: 'source policy', confidence: 1,
      source_span: { path: 'raw/source.md', start_line: 1, end_line: 5 },
    }] }) } : undefined
    const execute = { command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate }
    await expect(sidecar(execute)).rejects.toThrow(/schema.page_meta_invalid/)
    expect(requests).toHaveLength(1)
    const checkpointPath = join(vault, '.octopus-kb', 'document-plans', `${String(pending.planHash)}-0.json`)
    const saved = JSON.parse(await readFile(checkpointPath, 'utf8'))
    // Reproduce an older build's saved, rejected metadata; the original response stays unchanged.
    saved.proposal.operations[0].frontmatter = { ...saved.proposal.operations[0].frontmatter, lang: 'zh', type: 'policy', role: 'policy' }
    await writeFile(checkpointPath, JSON.stringify(saved), 'utf8')
    const result = await sidecar(execute)
    expect(result.status).toBe('completed')
    expect(result.error).toBeUndefined()
    expect(result.tokensUsed).toBe(Number(pending.totalChunks) * 38)
    expect(requests).toHaveLength(Number(pending.totalChunks))
    const repaired = JSON.parse(await readFile(checkpointPath, 'utf8'))
    expect(repaired.attemptId).toBe(saved.attemptId)
    expect(repaired.content).toBe(saved.content)
    expect(repaired.proposal.operations[0].frontmatter).toMatchObject({ type: 'note', role: 'note' })
    expect(await readFile(join(vault, 'wiki', 'SavedPolicy.md'), 'utf8')).toContain('社区培训预算须有正规凭证。')
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

  it('dynamically observes earlier chunk commits in later chunk prompts without changing planHash (A3)', async () => {
    const pending = await plan()
    customResponder = (reqIndex) => {
      if (reqIndex === 1) {
        return {
          content: JSON.stringify({
            operations: [{
              op: 'create_page',
              path: 'wiki/CommunityTraining.md',
              frontmatter: { title: 'CommunityTraining', type: 'concept', role: 'concept', layer: 'wiki', lang: 'zh', summary: '社区培训预算政策' },
              body: '社区培训预算须有正规凭证，并在报销前由管理员审批。',
              rationale: 'first chunk concept',
              confidence: 1.0,
              source_span: { path: 'raw/source.md', start_line: 1, end_line: 5 },
            }],
          }),
        }
      }
      return undefined
    }
    const result = await sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate })
    expect(result.status).toBe('completed')
    expect(requests.length).toBeGreaterThanOrEqual(2)
    // Chunk 2 request must contain CommunityTraining committed by Chunk 1
    const secondReq = requests[1]
    expect(secondReq).toBeDefined()
    if (!secondReq) throw new Error('Missing second request')
    const secondReqBody = JSON.parse(secondReq) as { messages: Array<{ content: string }> }
    const secondPrompt = secondReqBody.messages[0]?.content ?? ''
    expect(secondPrompt).toContain('wiki/CommunityTraining.md')
    expect(secondPrompt).toContain('社区培训预算政策')

    // Wiki file changes must not alter the range manifest planHash or work identity
    await writeFile(join(vault, 'wiki', 'ExtraManualNote.md'), '---\ntitle: Extra\npage_type: note\nlang: zh\nrole: note\n---\n# Extra\n')
    const recheckedPlan = await plan()
    expect(recheckedPlan.planHash).toBe(pending.planHash)

    // Re-running completed work does not make duplicate LLM calls
    const callsBefore = requests.length
    const rerun = await sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate })
    expect(rerun.status).toBe('completed')
    expect(requests).toHaveLength(callsBefore)
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('refuses completion on output-limit finish reason and keeps remaining work visible (A4)', async () => {
    const pending = await plan()
    customResponder = () => ({
      content: JSON.stringify({ operations: [] }),
      finishReason: 'length',
    })
    await expect(sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate })).rejects.toThrow(/output limit/i)
    const status = await sidecar({ command: 'document-status', vault, libraryId: 'library-1', documentId: 'doc-1' })
    const documents = Array.isArray(status.documents)
      ? status.documents as Array<{ status?: string; completedChunks?: number; totalChunks?: number; tokensUsed?: number }>
      : []
    const doc = documents[0]
    expect(doc).toBeDefined()
    expect(doc?.status).toBe('paused')
    expect(doc?.completedChunks).toBe(0)
    expect(doc?.totalChunks).toBe(pending.totalChunks)
    // Provider usage must be retained even when output limit rejects chunk completion
    expect(doc?.tokensUsed).toBe(38)

    // Checkpoint must store the response, content, and finish_reason
    const cpPath = join(vault, '.octopus-kb', 'document-plans', `${String(pending.planHash)}-0.json`)
    const cp = JSON.parse(await readFile(cpPath, 'utf8')) as { state: string; finishReason: string; content: string }
    expect(cp.state).toBe('response')
    expect(cp.finishReason).toBe('length')
    expect(cp.content).toBeDefined()
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('requires an explicit outcome decision to resume an uncertain call', async () => {
    const pending = await plan()
    // Inject uncertain calling state for chunk 0
    const checkpointPath = join(vault, '.octopus-kb', 'document-plans', `${String(pending.planHash)}-0.json`)
    await writeFile(checkpointPath, JSON.stringify({ state: 'calling', requestHash: 'hash-abc', attemptId: 'att-1' }), 'utf8')

    // Calling execute-document without explicit outcome decision must fail
    await expect(sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate })).rejects.toThrow(/uncertain.*explicit outcome decision/i)

    // Calling with explicit replay outcome decision allows deliberate resumption
    const finished = await sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate, uncertainOutcome: 'replay' })
    expect(finished.status).toBe('completed')
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('retains conflicting policies as distinct conflict pages across multiple chunks and preserves existing manual edits (A6, A13)', async () => {
    // Pre-create an existing wiki page with manual human authoring
    const manualPath = join(vault, 'wiki', 'BudgetRules.md')
    const manualContent = '---\ntitle: BudgetRules\ntype: concept\nrole: concept\nlayer: wiki\nlang: zh\nsummary: 人工审核规则\n---\n# BudgetRules\n【人工编辑】社区培训预算必须于活动前30天提交申请，不得例外。\n'
    await writeFile(manualPath, manualContent, 'utf8')

    const pending = await plan()
    customResponder = (reqIndex) => {
      if (reqIndex === 1) {
        return {
          content: JSON.stringify({
            operations: [{
              op: 'create_page',
              path: 'wiki/BudgetRules.md',
              frontmatter: { title: 'BudgetRules', type: 'concept', role: 'concept', layer: 'wiki', lang: 'zh', summary: '新文档预算规则1' },
              body: '新文档规定：社区培训预算仅需于活动前7天提交。',
              rationale: 'conflicting newer policy chunk 0',
              confidence: 1.0,
              source_span: { path: 'raw/source.md', start_line: 1, end_line: 5 },
            }],
          }),
        }
      }
      if (reqIndex === 2) {
        return {
          content: JSON.stringify({
            operations: [{
              op: 'create_page',
              path: 'wiki/BudgetRules.md',
              frontmatter: { title: 'BudgetRules', type: 'concept', role: 'concept', layer: 'wiki', lang: 'zh', summary: '新文档预算规则2' },
              body: '新文档进一步规定：特急申请可提前3天提交。',
              rationale: 'conflicting newer policy chunk 1',
              confidence: 1.0,
              source_span: { path: 'raw/source.md', start_line: 300, end_line: 305 },
            }],
          }),
        }
      }
      return undefined
    }

    const result = await sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate })
    expect(result.status).toBe('completed')

    // Existing page and human edit must be completely preserved
    const afterManual = await readFile(manualPath, 'utf8')
    expect(afterManual).toBe(manualContent)

    // First conflict page from chunk 0
    const shortRev = revisionId.slice(0, 8)
    const conflict0Path = join(vault, 'wiki', `BudgetRules-conflict-${shortRev}.md`)
    const conflict0Content = await readFile(conflict0Path, 'utf8')
    expect(conflict0Content).toContain('Conflicting policy with [[BudgetRules]]')
    expect(conflict0Content).toContain('新文档规定：社区培训预算仅需于活动前7天提交。')
    expect(conflict0Content).toContain(revisionId)

    // Second conflict page from chunk 1 differentiated by stable chunk identity
    const conflict1Path = join(vault, 'wiki', `BudgetRules-conflict-${shortRev}-c1.md`)
    const conflict1Content = await readFile(conflict1Path, 'utf8')
    expect(conflict1Content).toContain('Conflicting policy with [[BudgetRules]]')
    expect(conflict1Content).toContain('新文档进一步规定：特急申请可提前3天提交。')
    expect(conflict1Content).toContain(revisionId)

    // INDEX.md must link original and all distinct conflict pages
    const indexContent = await readFile(join(vault, 'wiki', 'INDEX.md'), 'utf8')
    expect(indexContent).toContain('[[BudgetRules]]')
    expect(indexContent).toContain(`[[BudgetRules (Conflict - ${shortRev})]]`)
    expect(indexContent).toContain(`[[BudgetRules (Conflict - ${shortRev} - Chunk 2)]]`)
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('rejects proposal citations outside the approved range or with fabricated page numbers', async () => {
    const pending = await plan()
    customResponder = () => ({
      content: JSON.stringify({
        operations: [{
          op: 'create_page',
          path: 'wiki/InvalidSpan.md',
          frontmatter: { title: 'InvalidSpan', type: 'concept', role: 'concept', layer: 'wiki', lang: 'zh', summary: '越界' },
          body: '越界内容',
          rationale: 'invalid span',
          confidence: 1.0,
          source_span: { path: 'raw/source.md', start_line: 9999, end_line: 10000 },
        }],
      }),
    })
    await expect(sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash,
      approvedTokens: pending.tokenEstimate })).rejects.toThrow(/outside the approved primary source range/i)
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('preserves concurrent manual edits and restores unmodified files during crash recovery (A13)', async () => {
    const manualDoc = 'wiki/ManualPolicy.md'
    const originalContent = '---\ntitle: ManualPolicy\ntype: policy\nrole: policy\nlayer: wiki\nlang: zh\nsummary: 原始版本\n---\n# 原始版本\n'
    await writeFile(join(vault, manualDoc), originalContent, 'utf8')

    const unmodifiedDoc = 'wiki/UnmodifiedPolicy.md'
    const unmodifiedOriginal = '---\ntitle: UnmodifiedPolicy\ntype: policy\nrole: policy\nlayer: wiki\nlang: zh\nsummary: 未修改版本\n---\n# 未修改版本\n'
    await writeFile(join(vault, unmodifiedDoc), unmodifiedOriginal, 'utf8')

    const proposalId = 'prop-crash-test'
    const stagingDir = join(vault, '.octopus-kb', 'staging', proposalId)
    await mkdir(join(stagingDir, 'backup', 'wiki'), { recursive: true })
    await mkdir(join(stagingDir, 'new', 'wiki'), { recursive: true })

    await writeFile(join(stagingDir, 'backup', manualDoc), originalContent, 'utf8')
    await writeFile(join(stagingDir, 'backup', unmodifiedDoc), unmodifiedOriginal, 'utf8')

    const stagedNewContent = '---\ntitle: ManualPolicy\ntype: policy\nrole: policy\nlayer: wiki\nlang: zh\nsummary: 提议新版本\n---\n# 提议新版本\n'
    await writeFile(join(stagingDir, 'new', manualDoc), stagedNewContent, 'utf8')
    const stagedUnmodifiedContent = '---\ntitle: UnmodifiedPolicy\ntype: policy\nrole: policy\nlayer: wiki\nlang: zh\nsummary: 提议覆盖\n---\n# 提议覆盖\n'
    await writeFile(join(stagingDir, 'new', unmodifiedDoc), stagedUnmodifiedContent, 'utf8')

    const createdDoc = 'wiki/CreatedPolicy.md'
    const stagedCreatedContent = '---\ntitle: CreatedPolicy\ntype: policy\nrole: policy\nlayer: wiki\nlang: zh\nsummary: 提议新增\n---\n# 提议新增\n'
    await writeFile(join(stagingDir, 'new', createdDoc), stagedCreatedContent, 'utf8')
    await writeFile(join(vault, createdDoc), stagedCreatedContent, 'utf8')
    await writeFile(join(vault, unmodifiedDoc), stagedUnmodifiedContent, 'utf8')

    // Concurrently edit manualDoc during the outage
    const concurrentEdit = '---\ntitle: ManualPolicy\ntype: policy\nrole: policy\nlayer: wiki\nlang: zh\nsummary: 用户紧急人工修改\n---\n# 紧急人工修改\n'
    await writeFile(join(vault, manualDoc), concurrentEdit, 'utf8')

    const now = new Date()
    const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const auditRecord = {
      proposal_id: proposalId,
      status: 'pending',
      staging_path: `.octopus-kb/staging/${proposalId}`,
      created: [createdDoc],
      modified: [manualDoc, unmodifiedDoc],
      created_at: now.toISOString(),
      applied_pages: [manualDoc, unmodifiedDoc, createdDoc],
      source: {},
    }
    await mkdir(join(vault, '.octopus-kb', 'audit'), { recursive: true })
    await writeFile(join(vault, '.octopus-kb', 'audit', `${timestamp}-${proposalId}.json`), JSON.stringify(auditRecord), 'utf8')

    const recoveryResult = await sidecar({ command: 'recover', vault, proposalId })
    expect(recoveryResult.status).toBe('rolled_back')

    // manualDoc had a concurrent manual edit, so recovery preserves it
    expect(await readFile(join(vault, manualDoc), 'utf8')).toBe(concurrentEdit)

    // unmodifiedDoc had no concurrent manual edit, so recovery restores it to original backup
    expect(await readFile(join(vault, unmodifiedDoc), 'utf8')).toBe(unmodifiedOriginal)

    // createdDoc had no concurrent manual edit, so recovery removes the staged creation
    let createdExists = true
    try {
      await readFile(join(vault, createdDoc), 'utf8')
    } catch {
      createdExists = false
    }
    expect(createdExists).toBe(false)
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('budgets conservative CJK wiki context allowance and executes within approved estimate (Finding 3)', async () => {
    await writeFile(join(vault, 'wiki', 'CommunityCJK.md'),
      '---\ntitle: Community\npage_type: concept\nlang: zh\nrole: concept\n---\n' + '制度'.repeat(3000), 'utf8')
    const cjkPlan = await sidecar({
      command: 'plan-document', vault, libraryId: 'library-1',
      documentId: 'doc-1', revisionId, rawPath: 'raw/source.md', chunkChars: 4000, contextChars: 6000,
    })
    expect(cjkPlan.status).toBe('awaiting_approval')
    const result = await sidecar({
      command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: cjkPlan.planHash, approvedTokens: cjkPlan.tokenEstimate,
    })
    expect(result.status).toBe('completed')
  }, PROCESS_INTEGRATION_TIMEOUT)
  it('retains two distinct conflicts from the same provider response without duplicate destinations', async () => {
    await writeFile(join(vault, 'wiki', 'BudgetRules.md'),
      '---\ntitle: BudgetRules\ntype: concept\nrole: concept\nlayer: wiki\nlang: en\nsummary: Manual rule\n---\n# BudgetRules\nOriginal manual policy.\n')
    const pending = await plan()
    customResponder = index => index === 1 ? {
      content: JSON.stringify({ operations: [0, 1, 0].map(claim => ({
        op: 'create_page', path: 'wiki/BudgetRules.md',
        frontmatter: { title: 'BudgetRules', type: 'concept', role: 'concept', layer: 'wiki', lang: 'en', summary: 'Source rule' },
        body: `Distinct conflicting rule ${claim}.`, rationale: 'source fact', confidence: 1,
        source_span: { path: 'raw/source.md', start_line: 1, end_line: 1 },
      })) }),
    } : undefined
    const result = await sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate })
    expect(result.status).toBe('completed')
    const { readdir } = await import('node:fs/promises')
    const paths = (await readdir(join(vault, 'wiki'))).filter(name => name.includes('-conflict-'))
    expect(paths).toHaveLength(2)
    const bodies = await Promise.all(paths.map(name => readFile(join(vault, 'wiki', name), 'utf8')))
    expect(bodies.filter(body => body.includes('Distinct conflicting rule 0.'))).toHaveLength(1)
    expect(bodies.filter(body => body.includes('Distinct conflicting rule 1.'))).toHaveLength(1)
    expect(await readFile(join(vault, 'wiki', 'BudgetRules.md'), 'utf8')).toContain('Original manual policy.')
  }, PROCESS_INTEGRATION_TIMEOUT)

  it('budgets complete context bundles with many long paths and four-byte Unicode', async () => {
    for (let i = 0; i < 100; i++) {
      await writeFile(join(vault, 'wiki', `${i.toString().padStart(3, '0')}${'x'.repeat(150)}.md`), '制度𐀀\\"'.repeat(10))
    }
    const pending = await sidecar({ command: 'plan-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      revisionId, rawPath: 'raw/source.md', chunkChars: 4000, contextChars: 2000 })
    const result = await sidecar({ command: 'execute-document', vault, libraryId: 'library-1', documentId: 'doc-1',
      expectedPlanHash: pending.planHash, approvedTokens: pending.tokenEstimate })
    expect(result.status).toBe('completed')
    expect(requests.length).toBe(pending.totalChunks)
    expect(requests.some(request => request.includes('x'.repeat(150)))).toBe(true)
  }, PROCESS_INTEGRATION_TIMEOUT)

})
