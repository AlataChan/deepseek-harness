import { describe, expect, it } from 'vitest'
import { parseUpstreamJson, scrubText, scrubUrl } from '../src/result.ts'

describe('Agent-Reach Result Decoder and Credential Scrubber', () => {
  it('drops arbitrary raw fields, cookies, and unwhitelisted metadata from items', () => {
    const rawStdout = JSON.stringify({
      schema_version: 1,
      ok: true,
      channel: 'web',
      action: 'read',
      backend: 'jina',
      items: [
        {
          url: 'https://example.com/post',
          title: 'Safe Title',
          author: 'Alice',
          published_at: '2026-11-01',
          text: 'Public page text',
          raw: { cookie: 'fixture-secret', internal_id: 12345 },
          unauthorized_blob: [1, 2, 3],
        },
      ],
      meta: {
        elapsed_ms: 120,
        attempts: ['jina'],
        access: { mode: 'public', scope: 'page_text', completeness_verified: false },
      },
    })

    const result = parseUpstreamJson(rawStdout, '', 'web', 'read')

    expect(result.ok).toBe(true)
    expect(result.items.length).toBe(1)
    const item = result.items[0]
    if (!item) throw new Error('Expected one decoded item')
    expect(item.title).toBe('Safe Title')
    expect(item.url).toBe('https://example.com/post')
    expect(item.author).toBe('Alice')
    expect(item.text).toBe('Public page text')

    // raw and unauthorized_blob must be completely absent
    expect((item as Record<string, unknown>).raw).toBeUndefined()
    expect((item as Record<string, unknown>).unauthorized_blob).toBeUndefined()
    expect(JSON.stringify(item)).not.toContain('fixture-secret')

    // Derived accessScope and completeness from verified metadata
    expect(result.accessScope).toBe('public')
    expect(result.completeness).toBe('partial')
  })

  it('scrubs credentials from URLs, search params, and Authorization headers', () => {
    const sensitiveUrl = 'https://admin:secret123@example.com/api?token=secret-token.123&other=safe'
    const scrubbed = scrubUrl(sensitiveUrl)
    expect(scrubbed).not.toContain('secret123')
    expect(scrubbed).not.toContain('secret-token.123')
    expect(scrubbed).toContain('other=safe')

    const textWithHeader = 'Request failed with Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test and cookie=sess_abc123'
    const scrubbedText = scrubText(textWithHeader)
    expect(scrubbedText).not.toContain('eyJhbGciOiJIUzI1NiJ9.test')
    expect(scrubbedText).not.toContain('sess_abc123')
  })

  it('fails closed on malformed upstream envelopes', () => {
    // meta is an array instead of object
    const badMetaEnvelope = JSON.stringify({
      schema_version: 1,
      ok: true,
      channel: 'web',
      action: 'read',
      items: [],
      meta: [],
    })
    const resMeta = parseUpstreamJson(badMetaEnvelope, '', 'web', 'read')
    expect(resMeta.ok).toBe(false)
    expect(resMeta.error?.code).toBe('MALFORMED_OUTPUT')

    // ok: true but items is missing
    const badEnvelope1 = JSON.stringify({
      schema_version: 1,
      ok: true,
      channel: 'web',
      action: 'read',
    })
    const res1 = parseUpstreamJson(badEnvelope1, '', 'web', 'read')
    expect(res1.ok).toBe(false)
    expect(res1.error?.code).toBe('MALFORMED_OUTPUT')

    // schema_version is not 1
    const badEnvelope2 = JSON.stringify({
      schema_version: 2,
      ok: true,
      channel: 'web',
      action: 'read',
      items: [],
      meta: { elapsed_ms: 50, attempts: [] },
    })
    const res2 = parseUpstreamJson(badEnvelope2, '', 'web', 'read')
    expect(res2.ok).toBe(false)
    expect(res2.error?.code).toBe('UNSUPPORTED_SCHEMA_VERSION')
  })

  it('keeps completeness as unknown when completeness_verified is absent', () => {
    const rawStdout = JSON.stringify({
      schema_version: 1,
      ok: true,
      channel: 'bilibili',
      action: 'search',
      backend: 'bili-cli',
      items: [{ title: 'Video 1', url: 'https://bilibili.com/video/BV123' }],
      meta: { elapsed_ms: 50, attempts: [] },
    })

    const result = parseUpstreamJson(rawStdout, '', 'bilibili', 'search')
    expect(result.ok).toBe(true)
    expect(result.completeness).toBe('unknown')
  })

  it('whitelists bounded attempt fields and drops arbitrary attempt objects, raw and secrets', () => {
    const rawStdout = JSON.stringify({
      schema_version: 1,
      ok: true,
      channel: 'web',
      action: 'read',
      items: [{ text: 'Content' }],
      meta: {
        elapsed_ms: 100,
        attempts: [
          { backend: 'jina', cookie: 'fixture-attempt-secret', raw: { nested: 'fixture-nested' }, status: 'ok' },
          'public-web token=attempt-token-secret',
        ],
      },
    })

    const result = parseUpstreamJson(rawStdout, '', 'web', 'read')
    expect(result.ok).toBe(true)
    const attemptsStr = JSON.stringify(result.meta.attempts)
    expect(attemptsStr).not.toContain('fixture-attempt-secret')
    expect(attemptsStr).not.toContain('fixture-nested')
    expect(attemptsStr).not.toContain('attempt-token-secret')
    expect(result.meta.attempts[0]).toBe('backend=jina status=ok')
    expect(result.meta.attempts[1]).toBe('public-web token=[REDACTED]')
  })
})

it('bounds aggregate variable fields including metadata and errors', () => {
  const wire = { schema_version:1,ok:true,channel:'v2ex',action:'hot',items:[{ title:'x'.repeat(10000) }],
    meta:{ elapsed_ms:1,attempts:[{ backend:'y'.repeat(10000) }] } }
  const result = parseUpstreamJson(JSON.stringify(wire), '', 'v2ex', 'hot', 64)
  expect(result.truncated).toBe(true)
  expect((result.items[0]?.title?.length ?? 0) + result.meta.attempts.join('').length + result.channel.length + result.action.length).toBeLessThanOrEqual(64)
})

it('redacts quoted JSON secrets and complete cookie headers', () => {
  for (const text of ['{"token":"json-secret"}', '{"Authorization":"Bearer auth-secret"}',
    'Cookie: SESSDATA=cookie-secret; other=also-secret']) {
    const result = scrubText(text)
    expect(result).not.toContain('json-secret')
    expect(result).not.toContain('auth-secret')
    expect(result).not.toContain('cookie-secret')
    expect(result).not.toContain('also-secret')
  }
})

it('keeps useful public excerpts after a login wall while marking them partial',async()=>{
  const { renderQueryResult }=await import('../src/presentation.ts')
  const result=parseUpstreamJson(JSON.stringify({ schema_version:1,ok:false,channel:'web',action:'read',
    items:[{ url:'https://example.com/public',text:'Public excerpt',raw:{ cookie:'never-export' } }],
    meta:{ elapsed_ms:1,attempts:[],access:{ mode:'public',completeness_verified:true } },
    error:{ code:'NEED_LOGIN',message:'Additional content requires login' } }),'','web','read')
  expect(result.ok).toBe(false)
  expect(result.completeness).toBe('partial')
  expect(result.meta.completenessVerified).toBe(false)
  expect(result.items[0]?.text).toBe('Public excerpt')
  const text=renderQueryResult(result)
  expect(text).toContain('NEED_LOGIN')
  expect(text).toContain('Public excerpt')
  expect(text).not.toContain('never-export')
})

it('retains explicit failures and fallbacks when output or optional wire fields are absent',async()=>{
  const { decodeUpstreamWire }=await import('../src/result.ts')
  for(const value of [null,[],12])expect(()=>decodeUpstreamWire(value)).toThrow()
  expect(parseUpstreamJson('','','fallback','read').error?.code).toBe('EMPTY_OUTPUT')
  expect(parseUpstreamJson('{','','fallback','read').error?.code).toBe('MALFORMED_OUTPUT')
  const failure=parseUpstreamJson(JSON.stringify({ schema_version:1,ok:false }),'','fallback','read')
  expect(failure.channel).toBe('fallback')
  expect(failure.error?.code).toBe('UPSTREAM_ERROR')
  expect(failure.error?.message).toBe('Unknown upstream error')
  const emptyError=parseUpstreamJson(JSON.stringify({ schema_version:1,ok:false,error:{ code:'',message:'',hint:12 } }),'','fallback','read')
  expect(emptyError.error?.code).toBe('UPSTREAM_ERROR')
  expect(emptyError.error?.hint).toBeUndefined()
  const future=parseUpstreamJson(JSON.stringify({ schema_version:99,ok:false }),'','fallback','read')
  expect(future.error?.code).toBe('UNSUPPORTED_SCHEMA_VERSION')
  expect(future.channel).toBe('fallback')
})
it('accepts optional access metadata while keeping unverified content unknown',()=>{
  const result=parseUpstreamJson(JSON.stringify({ schema_version:1,ok:true,channel:'',action:'',items:[],meta:{ access:{} } }),'','fallback','read')
  expect(result.channel).toBe('fallback')
  expect(result.completeness).toBe('unknown')
  const session=parseUpstreamJson(JSON.stringify({ schema_version:1,ok:true,items:[],meta:{ access:{ mode:'session' },completeness_verified:true } }),'','web','read')
  expect(session.accessScope).toBe('session')
  expect(session.completeness).toBe('complete')
})
it('drops invalid item values and bounds legacy date plus oversized content',()=>{
  const result=parseUpstreamJson(JSON.stringify({ schema_version:1,ok:true,items:[null,12,[],'bad',{ date:'2026-01-01',text:'a'.repeat(200) }],meta:{} }),'','web','read',100)
  expect(result.items).toHaveLength(1)
  expect(result.items[0]?.publishedAt).toBe('2026-01-01')
  expect(result.items[0]?.text?.length).toBeLessThan(100)
  expect(result.truncated).toBe(true)
  expect(scrubText("secret='private value'")).not.toContain('private value')
})
it('keeps a sanitized login hint without requesting credentials in the conversation',()=>{
  const result=parseUpstreamJson(JSON.stringify({ schema_version:1,ok:false,error:{ code:'NEED_LOGIN',message:'Login required',hint:'token=private' } }),'','web','read')
  expect(result.error?.hint).toContain('[REDACTED]')
  expect(result.error?.hint).not.toContain('private')
})
