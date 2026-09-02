#!/usr/bin/env node
/**
 * Deterministic sidecar used by overlay tests. Reads one JSON object from
 * stdin and writes one JSON object to stdout. Never echoes DEEPSEEK_API_KEY.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

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

function ok(extra = {}) {
  process.stdout.write(`${JSON.stringify({ ok: true, ...extra })}\n`)
}

function fail(error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error })}\n`)
  process.exitCode = 1
}

switch (request.command) {
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
  default:
    fail(`unknown command: ${request.command}`)
}
