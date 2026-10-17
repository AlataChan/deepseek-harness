#!/usr/bin/env node
/**
 * Deterministic sidecar used by overlay tests. Reads one JSON object from
 * stdin and writes one JSON object to stdout. Never echoes DEEPSEEK_API_KEY.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, lstatSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

const envFile = process.env.ASK_KNOWLEDGE_FAKE_ENV_FILE
if (envFile !== undefined && envFile !== '') {
  try {
    const extra = JSON.parse(readFileSync(envFile, 'utf8'))
    if (extra !== null && typeof extra === 'object' && !Array.isArray(extra)) {
      Object.assign(process.env, extra)
    }
  } catch {
    // missing overlay file means the wrapper still uses process.env only
  }
}

const stamp = process.env.ASK_KNOWLEDGE_FAKE_STAMP
if (stamp !== undefined && stamp !== '') {
  await writeFile(stamp, 'started\n', 'utf8')
}

const hold = Number(process.env.ASK_KNOWLEDGE_FAKE_HOLD_MS ?? '0')
if (Number.isFinite(hold) && hold > 0) {
  await new Promise(resolve => setTimeout(resolve, hold))
}

const raw = await new Promise((resolve, reject) => {
  const chunks = []
  process.stdin.on('data', chunk => { chunks.push(chunk) })
  process.stdin.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
  process.stdin.on('error', reject)
})

let request
try {
  request = JSON.parse(raw.trim() || '{}')
} catch {
  process.stdout.write(`${JSON.stringify({ ok: false, error: 'invalid json' })}\n`)
  process.exit(2)
}

import { writeFileSync } from 'node:fs'

function ok(extra = {}) {
  const result = { ok: true, ...extra }
  if (request.resultPath || request.result_file) {
    const resPath = request.resultPath || request.result_file
    const content = JSON.stringify(result)
    writeFileSync(resPath, content, 'utf8')
    process.stdout.write(`${JSON.stringify({
      ok: true,
      protocol: 'file-result-v1',
      resultPath: resPath,
      byteLength: Buffer.byteLength(content),
      sha256: createHash('sha256').update(content).digest('hex'),
    })}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

function fail(error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error })}\n`)
  process.exitCode = 1
}

switch (request.command) {
  case 'plan-document': {
    const text = readFileSync(join(request.vault, request.rawPath), 'utf8')
    // This fixture records planning only and never simulates paid provider success.
    const planHash = createHash('sha256').update(JSON.stringify({ request, text })).digest('hex')
    ok({ documentId: request.documentId, revisionId: request.revisionId, libraryId: request.libraryId,
      jobId: request.jobId ?? `job-${request.documentId}`, planHash,
      status: 'awaiting_approval', budgetApproved: false, rawPath: request.rawPath,
      totalChunks: Math.ceil(text.length / (request.chunkChars ?? 1500)), completedChunks: 0,
      tokenEstimate: Buffer.byteLength(text) * 2 + 10000 })
    break
  }
  case 'record-conversion':
    ok({})
    break
  case 'execute-document':
    fail('The fixture sidecar does not execute provider inference; use a recording provider test')
    break
  case 'self-test': {
    const key = process.env.DEEPSEEK_API_KEY ?? ''
    const result = {
      compound: true,
      prompts: true,
      schemas: true,
      markitdown: false,
      hasDeepseekKey: key !== '',
    }
    if (process.env.ASK_KNOWLEDGE_SIDECAR_KEY_HASH === '1') {
      result.keyHash = createHash('sha256').update(key).digest('hex')
    }
    ok(result)
    break
  }
  case 'bootstrap':
    ok({ vault: request.vault })
    break
  case 'inbox-list': {
    if (process.env.ASK_KNOWLEDGE_FAKE_INBOX_FAIL === '1') {
      fail('inbox failed')
      break
    }
    if (process.env.ASK_KNOWLEDGE_FAKE_INBOX_NO_ITEMS === '1') {
      ok({ deferredCount: 0 })
      break
    }
    const items = JSON.parse(process.env.ASK_KNOWLEDGE_FAKE_INBOX ?? '[]')
    if (process.env.ASK_KNOWLEDGE_FAKE_INBOX_BARE === '1') {
      ok({ items })
      break
    }
    ok({ deferredCount: items.length, items })
    break
  }
  case 'recover':
    ok({ recovered: true, proposalId: request.proposalId })
    break
  case 'ingest-file': {
    if (process.env.ASK_KNOWLEDGE_FAKE_INGEST_FAIL === '1') {
      fail('ingest failed')
      break
    }
    if (process.env.ASK_KNOWLEDGE_FAKE_INGEST_NO_RAW === '1') {
      ok({})
      break
    }
    const destName = `${basename(request.path).replace(/\.[^.]+$/, '')}.md`
    await mkdir(join(request.vault, 'raw'), { recursive: true })
    await copyFile(request.path, join(request.vault, 'raw', destName))
    if (process.env.ASK_KNOWLEDGE_FAKE_INGEST_EXTRA === '1') {
      await writeFile(join(request.vault, 'raw', 'extra.md'), '# extra\n', 'utf8')
    }
    ok({ rawRelPath: `raw/${destName}` })
    break
  }
  case 'convert-file': {
    if (process.env.ASK_KNOWLEDGE_FAKE_CONVERT_FAIL === '1') {
      fail(process.env.ASK_KNOWLEDGE_FAKE_CONVERT_ERROR ?? 'convert failed')
      break
    }
    const sourcePath = String(request.path ?? '')
    let body
    try {
      body = readFileSync(sourcePath, 'utf8')
    } catch {
      fail('missing file')
      break
    }
    if (process.env.ASK_KNOWLEDGE_FAKE_CONVERT_NO_BODY === '1') {
      ok({ title: 'missing', sourceFile: basename(sourcePath) })
      break
    }
    if (process.env.ASK_KNOWLEDGE_FAKE_CONVERT_BLANK === '1') {
      ok({ body: '   ', title: 'blank', sourceFile: basename(sourcePath) })
      break
    }
    if (process.env.ASK_KNOWLEDGE_FAKE_CONVERT_EMPTY === '1' || body.trim() === '') {
      fail('这份 PDF 没有可提取的文字。扫描件还不能作为会话附件。')
      break
    }
    if (process.env.ASK_KNOWLEDGE_FAKE_CONVERT_HUGE === '1') {
      body = `${'字'.repeat(32_001)}\n`
    }
    ok({
      body,
      title: basename(sourcePath).replace(/\.[^.]+$/, ''),
      sourceFile: basename(sourcePath),
    })
    break
  }
  case 'convert-document': {
    const sourcePath = String(request.path ?? '')
    const ext = extname(sourcePath).toLowerCase()
    if (ext === '.pdf') {
      if (sourcePath.includes('scan') || sourcePath.includes('empty')) {
        ok({
          status: 'needs_ocr',
          markdown: '',
          blocks: [],
          diagnostics: {
            warnings: ['page 1 of 1 needs OCR'],
            omissions: ['page 1'],
            unsupportedFeatures: ['cloud OCR disabled'],
            needsOcrPages: [1],
            totalPages: 1,
          },
        })
        break
      }
      if (sourcePath.includes('mixed')) {
        ok({
          status: 'partial',
          markdown: 'Community Training Plan\n\nBudget 2000 dollars',
          blocks: [
            {
              id: 'p1_b1',
              kind: 'heading',
              text: 'Community Training Plan',
              page: 1,
              charOffset: 0,
            },
          ],
          diagnostics: {
            warnings: ['page 2 of 2 needs OCR'],
            omissions: ['page 2'],
            unsupportedFeatures: ['cloud OCR disabled'],
            needsOcrPages: [2],
            totalPages: 2,
          },
        })
        break
      }
      ok({
        status: 'complete',
        markdown: 'Community Training Plan\n\nBudget 2000 dollars',
        blocks: [
          {
            id: 'p1_b1',
            kind: 'heading',
            text: 'Community Training Plan',
            page: 1,
            charOffset: 0,
          },
        ],
        diagnostics: {
          warnings: [],
          omissions: [],
          unsupportedFeatures: [],
          totalPages: 1,
        },
      })
      break
    }
    let body = ''
    try {
      body = readFileSync(sourcePath, 'utf8')
    } catch {}
    ok({
      status: 'complete',
      markdown: body,
      blocks: [
        {
          id: 'b1',
          kind: 'paragraph',
          text: body,
          charOffset: 0,
        },
      ],
      diagnostics: {
        warnings: [],
        omissions: [],
        unsupportedFeatures: [],
      },
    })
    break
  }
  case 'propose': {
    if (process.env.ASK_KNOWLEDGE_FAKE_PROPOSE) {
      fail(process.env.ASK_KNOWLEDGE_FAKE_PROPOSE === 'fail'
        ? 'propose failed'
        : process.env.ASK_KNOWLEDGE_FAKE_PROPOSE)
      break
    }
    if (process.env.ASK_KNOWLEDGE_FAKE_PROPOSE_NO_ID === '1') {
      ok({})
      break
    }
    const id = process.env.ASK_KNOWLEDGE_FAKE_PROPOSAL_ID ?? 'prop-1'
    const path = `.octopus-kb/proposals/${id}.json`
    await mkdir(join(request.vault, '.octopus-kb', 'proposals'), { recursive: true })
    await writeFile(join(request.vault, path), `${JSON.stringify({ id })}\n`, 'utf8')
    if (process.env.ASK_KNOWLEDGE_FAKE_PROPOSE_CAMEL === '1') {
      ok({ proposalId: id, path })
      break
    }
    ok({ proposalId: id, proposal_id: id, path })
    break
  }
  case 'validate-apply': {
    if (process.env.ASK_KNOWLEDGE_FAKE_APPLY === 'fail') {
      fail('apply failed')
      break
    }
    const proposalName = basename(String(request.proposal ?? ''), '.json')
    if (
      process.env.ASK_KNOWLEDGE_FAKE_APPLY === 'reject-old'
      && proposalName === (process.env.ASK_KNOWLEDGE_FAKE_OLD_PROPOSAL_ID ?? 'prop-1')
    ) {
      fail('old proposal rejected')
      break
    }
    if (process.env.ASK_KNOWLEDGE_FAKE_APPLY === 'rejected') {
      ok({ status: 'rejected' })
      break
    }
    if (process.env.ASK_KNOWLEDGE_FAKE_APPLY === 'rejected-post-lint') {
      ok({
        status: 'rejected_post_lint',
        verdict: 'pass',
        rule_results: [{
          rule_id: 'ALIAS_COLLISION',
          verdict: 'reject',
          reason: 'wiki/a.md,wiki/b.md: Alias `多代理` resolves to multiple pages',
        }],
      })
      break
    }
    if (process.env.ASK_KNOWLEDGE_FAKE_APPLY === 'deferred') {
      ok({ status: 'deferred', deferredCount: 1, deferred_count: 1 })
      break
    }
    if (process.env.ASK_KNOWLEDGE_FAKE_APPLY === 'deferred-snake') {
      ok({ status: 'applied', deferred_count: 1 })
      break
    }
    if (process.env.ASK_KNOWLEDGE_FAKE_APPLY === 'deferred-camel') {
      ok({ status: 'deferred', deferredCount: 2 })
      break
    }
    if (process.env.ASK_KNOWLEDGE_FAKE_APPLY === 'deferred-empty') {
      ok({ status: 'deferred' })
      break
    }
    await mkdir(join(request.vault, 'wiki'), { recursive: true })
    await writeFile(join(request.vault, 'wiki', '报销.md'), '# 报销\n\n报销流程正文。\n', 'utf8')
    ok({ status: 'applied', deferredCount: 0 })
    break
  }
  case 'retrieve-bundle': {
    if (process.env.ASK_KNOWLEDGE_FAKE_RETRIEVE_JSON) {
      ok(JSON.parse(process.env.ASK_KNOWLEDGE_FAKE_RETRIEVE_JSON))
      break
    }
    const query = String(request.query ?? '')
    if (query.includes('报销') || query.includes('党的纪律处分条例')) {
      ok({
        items: [{
          path: query.includes('党') ? 'wiki/党的纪律处分条例.md' : 'wiki/报销.md',
          title: query.includes('党') ? '党的纪律处分条例' : '报销',
          reason: 'title_match',
          kind: 'raw',
          text: query.includes('党') ? '党的纪律处分条例正文。' : '报销流程正文。',
        }],
      })
      break
    }
    ok({ items: [] })
    break
  }
  case 'lookup': {
    if (process.env.ASK_KNOWLEDGE_FAKE_LOOKUP_JSON) {
      ok(JSON.parse(process.env.ASK_KNOWLEDGE_FAKE_LOOKUP_JSON))
      break
    }
    ok({
      term: request.term,
      canonicalPath: 'wiki/报销.md',
      text: '报销流程正文。',
    })
    break
  }
  case 'passage-search': {
    if (process.env.ASK_KNOWLEDGE_FAKE_PASSAGE_SEARCH_JSON) {
      ok(JSON.parse(process.env.ASK_KNOWLEDGE_FAKE_PASSAGE_SEARCH_JSON))
      break
    }
    const queries = request.queries || (request.query ? [request.query] : [])
    const fold = value => value.normalize('NFKC').toLocaleLowerCase()
    const items = []
    for (const folder of ['raw', 'wiki']) {
      const dir = join(request.vault, folder)
      let names = []
      try { names = readdirSync(dir) } catch {}
      for (const name of names.sort()) {
        if (!name.endsWith('.md') || ['INDEX.md', 'LOG.md'].includes(name)) continue
        const file = join(dir, name)
        if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) continue
        const text = readFileSync(file, 'utf8')
        if (!queries.some(query => fold(text).includes(fold(query)))) continue
        const path = `${folder}/${name}`
        if (request.documentFilter && request.documentFilter !== path) continue
        items.push({ path, title: basename(name, '.md'),
          passageId: createHash('sha256').update(path).digest('hex'),
          kind: folder === 'raw' ? 'raw_passage' : 'concept', text, score: 100 })
      }
    }
    ok({ items: items.slice(0, request.limit ?? 12), cursor: null, total_matches: items.length,
      generation_id: createHash('sha256').update(JSON.stringify(items)).digest('hex'), warnings: [] })
    break
  }
  case 'index-vault':
    ok({ indexed_files: 1, total_passages: 1, generation_id: 'gen-fake-1' })
    break
  case 'runtime-check':
    ok({ ok: true, sqlite_version: '3.50.4', fts5: true, trigram: true, error: null })
    break
  case 'register-source-revision': {
    const docFile = join(request.vault, '.octopus-kb', 'fake-docs.json')
    let store = { docs: [], revs: {} }
    try {
      store = JSON.parse(readFileSync(docFile, 'utf8'))
    } catch {}
    const revId = `rev-${String(request.sha256).slice(0, 16)}`
    const doc = {
      id: request.documentId,
      libraryId: request.libraryId,
      displayFilename: request.filename,
      activeRevisionId: revId,
      status: 'retained',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const rev = {
      revisionId: revId,
      documentId: request.documentId,
      libraryId: request.libraryId,
      sha256: request.sha256,
      byteLength: request.byteLength,
      originalFilename: request.filename,
      objectPath: request.objectPath,
      status: 'retained',
      importedAt: new Date().toISOString(),
      mimeType: request.mimeType ?? null,
    }
    store.docs = store.docs.filter(d => d.id !== request.documentId).concat(doc)
    store.revs[revId] = rev
    await mkdir(join(request.vault, '.octopus-kb'), { recursive: true })
    await writeFile(docFile, JSON.stringify(store), 'utf8')
    ok({ document: doc, revision: rev })
    break
  }
  case 'get-document': {
    const docFile = join(request.vault, '.octopus-kb', 'fake-docs.json')
    let store = { docs: [], revs: {} }
    try { store = JSON.parse(readFileSync(docFile, 'utf8')) } catch {}
    const found = store.docs.find(d => d.id === request.documentId)
    ok({ document: found ?? null })
    break
  }
  case 'list-documents': {
    const docFile = join(request.vault, '.octopus-kb', 'fake-docs.json')
    let store = { docs: [], revs: {} }
    try { store = JSON.parse(readFileSync(docFile, 'utf8')) } catch {}
    const docs = store.docs.filter(d => !request.libraryId || d.libraryId === request.libraryId)
    ok({ documents: docs })
    break
  }
  case 'get-source-revision': {
    const docFile = join(request.vault, '.octopus-kb', 'fake-docs.json')
    let store = { docs: [], revs: {} }
    try { store = JSON.parse(readFileSync(docFile, 'utf8')) } catch {}
    const found = store.revs[request.revisionId]
    if (found) {
      ok({ revision: found })
    } else {
      ok({
        revision: {
          revisionId: request.revisionId,
          documentId: 'doc-fake',
          libraryId: '11111111-1111-1111-1111-111111111111',
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          byteLength: 0,
          originalFilename: 'test.md',
          objectPath: `.octopus-kb/sources/${request.revisionId}/original`,
          status: 'retained',
          importedAt: new Date().toISOString(),
          mimeType: null,
        },
      })
    }
    break
  }
  case 'verify-source-integrity':
    ok({ status: 'retained' })
    break
  case 'get-startup-attempt':
    ok({ startupAttempt: 1 })
    break
  case 'increment-startup-attempt':
    ok({ startupAttempt: 2 })
    break
  case 'create-job':
    ok({ jobId: request.jobId, startupAttempt: request.startupAttempt, status: 'active' })
    break
  case 'update-job-checkpoint':
    ok({ jobId: request.jobId, completedChunks: request.completedChunks })
    break
  case 'finish-job':
    ok({ jobId: request.jobId, status: request.status ?? 'completed' })
    break
  case 'mark-job-uncertain':
    ok({ jobId: request.jobId, isUncertain: true, status: 'paused' })
    break
  case 'cancel-job':
    ok({ jobId: request.jobId, status: 'cancelled' })
    break
  case 'create-chunks': {
    const text = request.text || ''
    const chunks = [{
      chunkId: 'chunk_0',
      primaryText: text,
      overlapPrefix: '',
      overlapSuffix: '',
      fullText: text,
      primaryStartChar: 0,
      primaryEndChar: text.length,
      headings: [],
      tableContext: '',
      diagnostics: { warnings: [], lateExceptions: [] },
    }]
    ok({ chunks, totalChunks: 1, fullCoverage: true })
    break
  }
  case 'verify-chunks':
    ok({ ok: true, valid: true, issues: [] })
    break
  case 'calculate-budget': {
    const chunks = request.chunks || []
    const tokens = chunks.length * 500
    ok({
      totalTokens: tokens,
      breakdown: { promptTokens: tokens * 0.4, boundedContextTokens: tokens * 0.2, outputTokens: tokens * 0.3, retryReserveTokens: tokens * 0.1 },
      approvedBudget: request.approvedBudget ?? null,
      exceedsApprovedBudget: request.approvedBudget !== undefined && request.approvedBudget !== null ? tokens > request.approvedBudget : false,
      chunksCount: chunks.length,
      policy: request.policy ?? 'byte-fallback',
    })
    break
  }
  case 'enrich-chunks': {
    const chunks = request.chunks || []
    ok({
      status: 'completed',
      completedChunks: chunks.length,
      totalChunks: chunks.length,
      tokensUsed: chunks.length * 500,
      appliedProposals: [],
    })
    break
  }
  case 'get-job':
    ok({ job: null })
    break
  case 'list-jobs':
    ok({ jobs: [] })
    break
  case 'migrate-library':
    ok({
      status: 'completed',
      migratedDocuments: 1,
      totalDocuments: 1,
      totalPassages: 1,
      generationId: 'gen-migrated-1',
    })
    break
  case 'cancel-library-jobs':
    ok({ cancelledCount: 0 })
    break
  default:
    fail(`unknown command: ${request.command}`)
}
