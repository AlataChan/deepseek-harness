/**
 * Wire decoding, schema validation, credential scrubbing, and whitelist-based result sanitation.
 *
 * @module @deepseek-ai/dsh-experimental-agent-reach/result
 */

import type { AccessScope, AgentReachItem, AgentReachResult, Completeness } from './types.ts'

const SENSITIVE_PARAM_NAMES = new Set([
  'token',
  'key',
  'apikey',
  'api_key',
  'secret',
  'password',
  'passwd',
  'session',
  'sessionid',
  'session_id',
  'sessdata',
  'bili_jct',
  'buvid',
  'auth',
  'authorization',
])

/**
 * Scrub credentials from URLs, including userinfo and query parameters.
 *
 * @param urlStr - input URL
 * @returns sanitized URL string
 */
export function scrubUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr)
    if (parsed.username || parsed.password) {
      parsed.username = '[REDACTED]'
      parsed.password = ''
    }
    const params = parsed.searchParams
    for (const key of Array.from(params.keys())) {
      if (SENSITIVE_PARAM_NAMES.has(key.toLowerCase()) || /token|secret|key|cookie|session/i.test(key)) {
        params.set(key, '[REDACTED]')
      }
    }
    return parsed.toString()
  } catch {
    // If not a parseable URL, apply regex scrubbing
    return scrubText(urlStr)
  }
}

/**
 * Scrub embedded credentials, tokens, cookies, and secret pairs from arbitrary text.
 *
 * @param text - raw text string
 * @returns sanitized text
 */
export function scrubText(text: string): string {
  let res = text.replace(/Authorization:\s*(?:Bearer|Basic)\s+[^\s]+/gi, 'Authorization: [REDACTED]')
  res = res.replace(
    new RegExp(
      String.raw`(\b[\w-]{0,64}(?:token|secret|key|password|session|cookie|sessdata|bili_jct|buvid|authorization|auth)`
        + String.raw`[\w-]{0,64}["']?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s&,;]+)`, 'gi',
    ),
    (_match, prefix: string, value: string) => {
      const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : ''
      return `${prefix}${quote}[REDACTED]${quote}`
    },
  )
  res = res.replace(/\b(?:Set-Cookie|Cookie)\s*:\s*[^\r\n]+/gi, 'Cookie: [REDACTED]')
  res = res.replace(/Authorization:\s*(?:Bearer|Basic)\s+[^\s]+/gi, 'Authorization: [REDACTED]')
  // Match user:pass@ in text
  res = res.replace(/(https?:\/\/)([^:\s/@]+):([^@\s/]+)@/gi, '$1[REDACTED]:[REDACTED]@')
  return res
}

/** Validated query envelope before output budgeting and item extraction. */
export interface DecodedUpstreamWire {
  readonly schemaVersion: number
  readonly ok: boolean
  readonly channel?: string | undefined
  readonly action?: string | undefined
  readonly backend?: string | undefined
  readonly items: readonly unknown[]
  readonly meta: {
    readonly elapsedMs: number
    readonly attempts: readonly string[]
    readonly accessMode?: string | undefined
    readonly completenessVerified?: boolean | undefined
  }
  readonly error?:
    | {
      readonly code: string
      readonly message: string
      readonly hint?: string | undefined
    }
    | undefined
}

/**
 * Perform genuine wire decoding of raw JSON output into a validated intermediate wire object.
 * Fails closed if the JSON shape does not match upstream protocol contracts.
 *
 * @param raw - parsed JSON value
 * @returns validated DecodedUpstreamWire
 * @throws Error if wire format is invalid
 */
export function decodeUpstreamWire(raw: unknown): DecodedUpstreamWire {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Upstream JSON output must be a non-null object')
  }

  const obj = raw as Record<string, unknown>
  if (typeof obj.schema_version !== 'number') {
    throw new Error('Missing or non-numeric schema_version')
  }
  if (typeof obj.ok !== 'boolean') {
    throw new Error('Missing or non-boolean ok status')
  }

  const schemaVersion = obj.schema_version
  const ok = obj.ok

  let channel: string | undefined
  if (obj.channel !== undefined && obj.channel !== null) {
    if (typeof obj.channel !== 'string') throw new Error('channel must be a string')
    channel = obj.channel
  }

  let action: string | undefined
  if (obj.action !== undefined && obj.action !== null) {
    if (typeof obj.action !== 'string') throw new Error('action must be a string')
    action = obj.action
  }

  let backend: string | undefined
  if (obj.backend !== undefined && obj.backend !== null) {
    if (typeof obj.backend !== 'string') throw new Error('backend must be a string')
    backend = obj.backend
  }

  let items: unknown[] = []
  if (obj.items !== undefined && obj.items !== null) {
    if (!Array.isArray(obj.items)) {
      throw new Error('items must be an array')
    }
    items = obj.items
  } else if (ok) {
    throw new Error('Successful upstream envelope must contain items array')
  }

  let elapsedMs = 0
  const attempts: string[] = []
  let accessMode: string | undefined
  let completenessVerified: boolean | undefined

  if (obj.meta !== undefined && obj.meta !== null) {
    if (typeof obj.meta !== 'object' || Array.isArray(obj.meta)) {
      throw new Error('meta must be a non-null object, not an array or primitive')
    }
    const metaObj = obj.meta as Record<string, unknown>
    if (typeof metaObj.elapsed_ms === 'number' && Number.isFinite(metaObj.elapsed_ms)) {
      elapsedMs = Math.max(0, Math.round(metaObj.elapsed_ms))
    }
    if (metaObj.attempts !== undefined && metaObj.attempts !== null) {
      if (!Array.isArray(metaObj.attempts)) {
        throw new Error('meta.attempts must be an array')
      }
      for (const att of metaObj.attempts) {
        if (typeof att === 'string') {
          attempts.push(scrubText(att))
        } else if (typeof att === 'object' && att !== null && !Array.isArray(att)) {
          // Whitelist bounded fields only: backend, elapsed_ms, status. Drop raw/cookies/tokens.
          const a = att as Record<string, unknown>
          for (const key of ['backend', 'status', 'result', 'error']) {
            if (a[key] != null && typeof a[key] !== 'string') throw new Error(`Invalid attempt ${key}`)
          }
          const parts: string[] = []
          if (typeof a.backend === 'string') {
            parts.push(`backend=${scrubText(a.backend)}`)
          }
          if (typeof a.status === 'string') {
            parts.push(`status=${scrubText(a.status)}`)
          }
          if (typeof a.result === 'string') parts.push(`result=${scrubText(a.result)}`)
          if (typeof a.error === 'string') parts.push(`error=${scrubText(a.error)}`)
          if (typeof a.elapsed_ms === 'number' && Number.isFinite(a.elapsed_ms)) {
            parts.push(`elapsed=${Math.round(a.elapsed_ms)}ms`)
          }
          if (parts.length > 0) {
            attempts.push(parts.join(' '))
          }
        } else {
          throw new Error('Each entry in meta.attempts must be a string or object')
        }
      }
    }
    if (metaObj.access !== undefined && metaObj.access !== null) {
      if (typeof metaObj.access !== 'object' || Array.isArray(metaObj.access)) {
        throw new Error('meta.access must be an object')
      }
      const acc = metaObj.access as Record<string, unknown>
      if (acc.mode != null && (typeof acc.mode !== 'string' || !['public', 'native', 'session'].includes(acc.mode))) throw new Error('Invalid access mode')
      if (acc.completeness_verified != null && typeof acc.completeness_verified !== 'boolean') throw new Error('Invalid completeness')
      if (typeof acc.mode === 'string') accessMode = acc.mode
      if (typeof acc.completeness_verified === 'boolean') completenessVerified = acc.completeness_verified
    }
    if (metaObj.elapsed_ms != null && (typeof metaObj.elapsed_ms !== 'number' || !Number.isFinite(metaObj.elapsed_ms) || metaObj.elapsed_ms < 0)) throw new Error('Invalid elapsed_ms')
    if (metaObj.completeness_verified != null && typeof metaObj.completeness_verified !== 'boolean') throw new Error('Invalid completeness')
    if (typeof metaObj.completeness_verified === 'boolean') {
      completenessVerified = metaObj.completeness_verified
    }
  } else if (ok) {
    throw new Error('Successful upstream output must contain meta object')
  }

  let error: { code: string; message: string; hint?: string | undefined } | undefined
  if (obj.error !== undefined && obj.error !== null) {
    if (typeof obj.error !== 'object' || Array.isArray(obj.error)) {
      throw new Error('error field must be an object')
    }
    const errObj = obj.error as Record<string, unknown>
    if (typeof errObj.code !== 'string' || typeof errObj.message !== 'string') {
      throw new Error('error object must contain code and message strings')
    }
    error = {
      code: errObj.code,
      message: errObj.message,
      hint: typeof errObj.hint === 'string' ? errObj.hint : undefined,
    }
  }

  return {
    schemaVersion,
    ok,
    channel,
    action,
    backend,
    items,
    meta: {
      elapsedMs,
      attempts,
      accessMode,
      completenessVerified,
    },
    error,
  }
}

/**
 * Parse upstream CLI output, scrub credentials, whitelist fields, and compute derived access and completeness.
 *
 * @param rawStdout - standard output from Agent-Reach CLI
 * @param rawStderr - standard error output
 * @param fallbackChannel - requested channel
 * @param fallbackAction - requested action
 * @param maxOutputChars - character ceiling for extracted model-visible content
 * @returns AgentReachResult
 */
function parseUnboundedJson(
  rawStdout: string,
  rawStderr: string,
  fallbackChannel: string,
  fallbackAction: string,
  maxOutputChars: number = 24000,
): AgentReachResult {
  const scrubbedStderr = scrubText(rawStderr)
  const trimmed = rawStdout.trim()

  if (!trimmed) {
    return {
      ok: false,
      channel: fallbackChannel,
      action: fallbackAction,
      items: [],
      meta: { elapsedMs: 0, attempts: [] },
      error: {
        code: 'EMPTY_OUTPUT',
        message: 'Agent-Reach CLI returned empty output',
        hint: scrubbedStderr.slice(-500) || undefined,
      },
      accessScope: 'public',
      completeness: 'unknown',
    }
  }

  let jsonVal: unknown
  try {
    jsonVal = JSON.parse(trimmed)
  } catch (err) {
    return {
      ok: false,
      channel: fallbackChannel,
      action: fallbackAction,
      items: [],
      meta: { elapsedMs: 0, attempts: [] },
      error: {
        code: 'MALFORMED_OUTPUT',
        message: `Failed to parse Agent-Reach output JSON: ${(err as Error).message}`,
        hint: scrubbedStderr.slice(-500) || undefined,
      },
      accessScope: 'public',
      completeness: 'unknown',
    }
  }

  let wire: DecodedUpstreamWire
  try {
    wire = decodeUpstreamWire(jsonVal)
  } catch (err) {
    return {
      ok: false,
      channel: fallbackChannel,
      action: fallbackAction,
      items: [],
      meta: { elapsedMs: 0, attempts: [] },
      error: {
        code: 'MALFORMED_OUTPUT',
        message: `Upstream JSON envelope is malformed: ${(err as Error).message}`,
        hint: scrubbedStderr.slice(-500) || undefined,
      },
      accessScope: 'public',
      completeness: 'unknown',
    }
  }

  if (wire.schemaVersion !== 1) {
    return {
      ok: false,
      channel: wire.channel || fallbackChannel,
      action: wire.action || fallbackAction,
      items: [],
      meta: { elapsedMs: wire.meta.elapsedMs, attempts: wire.meta.attempts },
      error: {
        code: 'UNSUPPORTED_SCHEMA_VERSION',
        message: `Unsupported Agent-Reach schema version: ${wire.schemaVersion} (expected 1)`,
      },
      accessScope: 'public',
      completeness: 'unknown',
    }
  }

  const channel = scrubText(wire.channel || fallbackChannel)
  const action = scrubText(wire.action || fallbackAction)
  const backend = wire.backend ? scrubText(wire.backend) : undefined

  // Derive observed accessScope from validated metadata
  let accessScope: AccessScope = 'public'
  if (wire.meta.accessMode === 'session') {
    accessScope = 'session'
  } else if (wire.meta.accessMode === 'native') {
    accessScope = 'native'
  }

  const failed = !wire.ok || wire.error !== undefined

  // Whitelist-only extraction of item fields.
  // Explicitly drops arbitrary nested fields, raw blobs, and cookies.
  const sanitizedItems: AgentReachItem[] = []
  let totalChars = 0
  let isTruncated = false

  for (const rawItem of wire.items) {
    if (typeof rawItem !== 'object' || rawItem === null || Array.isArray(rawItem)) {
      continue
    }
    const r = rawItem as Record<string, unknown>

    let url: string | undefined
    if (typeof r.url === 'string') {
      url = scrubUrl(r.url)
      totalChars += url.length
    }

    let title: string | undefined
    if (typeof r.title === 'string') {
      title = scrubText(r.title)
      totalChars += title.length
    }

    let author: string | undefined
    if (typeof r.author === 'string') {
      author = scrubText(r.author)
      totalChars += author.length
    }

    let publishedAt: string | undefined
    if (typeof r.published_at === 'string') {
      publishedAt = scrubText(r.published_at)
      totalChars += publishedAt.length
    } else if (typeof r.date === 'string') {
      publishedAt = scrubText(r.date)
      totalChars += publishedAt.length
    }

    let text: string | undefined
    if (typeof r.text === 'string') {
      let t = scrubText(r.text)
      if (totalChars + t.length > maxOutputChars) {
        const allowed = Math.max(0, maxOutputChars - totalChars)
        t = t.slice(0, allowed)
        isTruncated = true
      }
      totalChars += t.length
      text = t
    }

    sanitizedItems.push({
      url,
      title,
      author,
      publishedAt,
      text,
    })

    if (totalChars >= maxOutputChars) {
      isTruncated = true
      break
    }
  }

  // Determine completeness: no synthetic 'complete' for nonempty output
  let completeness: Completeness = 'unknown'
  if (isTruncated) {
    completeness = 'truncated'
  } else if (failed && sanitizedItems.length > 0) {
    completeness = 'partial'
  } else if (failed) {
    completeness = 'unknown'
  } else if (wire.meta.completenessVerified === true) {
    completeness = 'complete'
  } else if (wire.meta.completenessVerified === false) {
    completeness = 'partial'
  } else {
    // Missing verification evidence stays unknown
    completeness = 'unknown'
  }

  return {
    ok: !failed,
    channel,
    action,
    backend,
    items: sanitizedItems,
    meta: {
      elapsedMs: wire.meta.elapsedMs,
      attempts: wire.meta.attempts,
      accessMode: wire.meta.accessMode,
      completenessVerified: failed ? false : wire.meta.completenessVerified,
    },
    ...(failed ? { error: {
      code:wire.error?.code || 'UPSTREAM_ERROR',message:scrubText(wire.error?.message || 'Unknown upstream error'),
      ...(wire.error?.hint ? { hint:scrubText(wire.error.hint) } : {}),
    } } : {}),
    accessScope,
    completeness,
    truncated: isTruncated,
  }
}

/**
 * Decode a query and bound all variable content; fixed JSON keys and status enums are overhead.
 * @param rawStdout - Complete bounded CLI JSON.
 * @param rawStderr - Private diagnostics to scrub.
 * @param fallbackChannel - Requested channel.
 * @param fallbackAction - Requested action.
 * @param maxOutputChars - Aggregate character budget for variable strings.
 * @param maxItems - Maximum returned items and attempts.
 * @returns Sanitized result with explicit truncation.
 */
export function parseUpstreamJson(
  rawStdout: string, rawStderr: string, fallbackChannel: string, fallbackAction: string,
  maxOutputChars = 24000, maxItems = 20,
): AgentReachResult {
  const result = parseUnboundedJson(rawStdout, rawStderr, fallbackChannel, fallbackAction, maxOutputChars)
  let remaining = maxOutputChars
  let truncated = result.truncated === true || result.items.length > maxItems || result.meta.attempts.length > maxItems
  const take = (value: string): string => {
    const safe = scrubText(value)
    const bounded = safe.slice(0, remaining)
    remaining -= bounded.length
    truncated ||= bounded.length < safe.length
    return bounded
  }
  const channel = take(result.channel)
  const action = take(result.action)
  const backend = result.backend === undefined ? undefined : take(result.backend)
  const error = result.error === undefined ? undefined : {
    code: take(result.error.code), message: take(result.error.message),
    ...(result.error.hint === undefined ? {} : { hint: take(result.error.hint) }),
  }
  const items = result.items.slice(0, maxItems).map(item => ({
    ...(item.title === undefined ? {} : { title: take(item.title) }),
    ...(item.url === undefined ? {} : { url: take(item.url) }),
    ...(item.author === undefined ? {} : { author: take(item.author) }),
    ...(item.publishedAt === undefined ? {} : { publishedAt: take(item.publishedAt) }),
    ...(item.text === undefined ? {} : { text: take(item.text) }),
  }))
  const attempts = result.meta.attempts.slice(0, maxItems).map(take)
  return {
    ...result, channel, action, ...(backend === undefined ? {} : { backend }), items,
    meta: { ...result.meta, attempts }, ...(error === undefined ? {} : { error }),
    truncated, completeness: truncated ? 'truncated' : result.completeness,
  }
}
