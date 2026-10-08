/**
 * Injectable MiniMax HTTP adapter for Stage 1 paid spikes.
 * Errors omit secrets, signed URLs, and raw media bytes.
 * @module @deepseek-ai/dsh-experimental-desktop-media/provider
 */

import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { credentialRef, type CredentialRef, type ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { MediaError } from './error.ts'

/** Domestic MiniMax Host used when `MINIMAX_BASE_URL` is unset. */
export const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimax.cn'

/** Credential reference the paid suite and later Host config resolve. */
export const MINIMAX_API_KEY_REF = credentialRef('MINIMAX_API_KEY')

/** Narrow credentials read used so tests can inject a source without a full provider. */
export interface MinimaxCredentialLookup {
  /** Resolve one reference. Must not log the value. */
  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>
}

/** Injectable HTTP and clock for MiniMax calls. */
export interface MinimaxTransport {
  /** Already-resolved API key. Never log this field. */
  readonly apiKey: string
  /** Absolute origin without a trailing slash. */
  readonly baseUrl: string
  /** Fetch implementation. */
  readonly fetch: typeof fetch
  /** Clock for poll deadlines. */
  readonly now: () => number
  /** Cancellable sleep. */
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>
}

/** One still sent with a video create. */
export interface VideoImageInput {
  /** MiniMax image role. Reference and first/last-frame are exclusive. */
  readonly role: 'reference' | 'first_frame' | 'last_frame'
  /** Declared MIME for the data URL. */
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
  /** Image bytes. Not logged. */
  readonly bytes: Uint8Array
}

/** Text-to-video create body the adapter will send. */
export interface CreateVideoTaskRequest {
  /** Provider model id. */
  readonly model: 'MiniMax-H3' | 'MiniMax-H3-Max'
  /** Non-empty prompt. */
  readonly prompt: string
  /** Output resolution. */
  readonly resolution: '480P' | '768P' | '2K'
  /** Integer duration in seconds. */
  readonly duration: number
  /** Required explicit ratio for text-to-video. */
  readonly ratio: '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
  /** H3-Max prompt expansion. Omit on H3. */
  readonly promptExpansionMode?: 'disabled' | 'balanced' | 'quality'
  /** Optional stills. Reference and first/last-frame must not mix. */
  readonly images?: readonly VideoImageInput[]
}

/** Poll timing. Callers pass both values; the adapter does not invent them. */
export interface VideoWaitTiming {
  /** Delay between queries in milliseconds. */
  readonly intervalMs: number
  /** Overall deadline in milliseconds. */
  readonly timeoutMs: number
}

/** Video task facts after a successful query. URLs stay on this object for download only. */
export interface VideoTask {
  /** Provider task id. */
  readonly id: string
  /** Model reported by the provider. */
  readonly model: string
  /** Provider status. */
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  /** Output seconds when the provider reported usage. */
  readonly outputSeconds?: number
  /** Time-limited download URL. Do not log. */
  readonly downloadUrl?: string
}

/** Formal TTS request. */
export interface SynthesizeSpeechRequest {
  /** TTS model id. */
  readonly model: string
  /** Text to speak. */
  readonly text: string
  /** System or cloned voice id. */
  readonly voiceId: string
  /** Container. Default mp3. */
  readonly format?: 'mp3' | 'pcm' | 'flac'
}

/** Formal TTS result. */
export interface SynthesizeSpeechResult {
  /** Decoded audio bytes. */
  readonly audio: Buffer
  /** Provider billed character count. */
  readonly usageCharacters: number
  /** Duration in milliseconds when reported. */
  readonly durationMs?: number
}

/** Voice-clone file upload. */
export interface VoiceCloneUpload {
  /** File name sent in multipart. */
  readonly filename: string
  /** Audio bytes. */
  readonly bytes: Uint8Array
}

/**
 * Resolve `MINIMAX_API_KEY` through credentials. Independent of `DEEPSEEK_API_KEY`.
 * @param credentials - lookup that returns the current secret.
 * @param ref - branded reference. Default {@link MINIMAX_API_KEY_REF}.
 * @returns the non-empty key.
 */
export async function resolveMinimaxApiKey(
  credentials: MinimaxCredentialLookup,
  ref: CredentialRef = MINIMAX_API_KEY_REF,
): Promise<string> {
  const resolved = await credentials.resolve(ref)
  const value = resolved?.value.trim() ?? ''
  if (value === '') {
    throw new MediaError('credential-missing', 'MINIMAX_API_KEY is not configured')
  }
  return value
}

/**
 * Build a transport from a resolved key and optional test doubles.
 * @param options.apiKey - resolved MiniMax secret.
 * @param options.baseUrl - absolute origin. Default {@link DEFAULT_MINIMAX_BASE_URL}.
 * @param options.fetch - injectable fetch. Default global `fetch`.
 * @param options.now - injectable clock.
 * @param options.sleep - injectable sleep.
 * @returns transport used by every MiniMax helper.
 */
export function createMinimaxTransport(options: {
  readonly apiKey: string
  readonly baseUrl?: string
  readonly fetch?: typeof fetch
  readonly now?: () => number
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}): MinimaxTransport {
  const apiKey = options.apiKey.trim()
  if (apiKey === '') {
    throw new MediaError('credential-missing', 'MINIMAX_API_KEY is not configured')
  }
  return {
    apiKey,
    baseUrl: resolveBaseUrl(options.baseUrl ?? DEFAULT_MINIMAX_BASE_URL),
    fetch: options.fetch ?? fetch,
    now: options.now ?? Date.now,
    sleep: options.sleep ?? sleep,
  }
}

/**
 * Allocate a clone `voice_id` that satisfies MiniMax's letter-prefix grammar.
 * @param randomId - injectable id source. Default `randomUUID`.
 * @returns an 8–256 character voice id.
 */
export function createCloneVoiceId(randomId: () => string = randomUUID): string {
  const voiceId = `dshVoice${randomId().replaceAll('-', '')}`
  if (!CLONE_VOICE_ID.test(voiceId)) {
    throw new MediaError('provider-invalid', 'generated voice_id failed MiniMax grammar')
  }
  return voiceId
}

/**
 * Create a text-to-video task.
 * @param transport - authenticated transport.
 * @param request - validated create fields.
 * @param signal - caller lifetime.
 * @returns provider task id.
 */
export async function createVideoTask(
  transport: MinimaxTransport,
  request: CreateVideoTaskRequest,
  signal: AbortSignal,
): Promise<string> {
  if (request.prompt.trim() === '') {
    throw new MediaError('provider-invalid', 'video prompt must be non-empty')
  }
  if (request.model === 'MiniMax-H3-Max' && request.resolution === '2K') {
    throw new MediaError('provider-invalid', 'MiniMax-H3-Max does not support 2K')
  }
  if (request.model === 'MiniMax-H3-Max' && request.duration < 5) {
    throw new MediaError('provider-invalid', 'MiniMax-H3-Max duration must be at least 5 seconds')
  }
  if (request.model === 'MiniMax-H3' && request.duration < 4) {
    throw new MediaError('provider-invalid', 'MiniMax-H3 duration must be at least 4 seconds')
  }
  const images = request.images ?? []
  const hasReference = images.some(image => image.role === 'reference')
  const hasEndpoint = images.some(image => image.role === 'first_frame' || image.role === 'last_frame')
  if (hasReference && hasEndpoint) {
    throw new MediaError('image-mode-conflict', 'reference images and first/last frames are exclusive')
  }
  if (images.some(image => image.bytes.byteLength === 0)) {
    throw new MediaError('provider-invalid', 'video image is empty')
  }
  const body: Record<string, unknown> = {
    model: request.model,
    content: [
      { type: 'text', text: request.prompt },
      ...images.map(image => ({
        type: 'image_url',
        image_url: {
          url: `data:${image.mediaType};base64,${Buffer.from(image.bytes).toString('base64')}`,
        },
        ...image.role === 'reference' ? {} : { role: image.role },
      })),
    ],
    resolution: request.resolution,
    duration: request.duration,
    ratio: request.ratio,
  }
  if (request.promptExpansionMode !== undefined) {
    body.extra = { prompt_expansion_mode: request.promptExpansionMode }
  }
  const doc = await jsonRequest(transport, 'POST', '/v2/video_generation', body, signal)
  const taskId = typeof doc.task_id === 'string' ? doc.task_id.trim() : ''
  if (taskId === '') {
    throw new MediaError('provider-invalid', 'video create response omitted task_id')
  }
  return taskId
}

/**
 * Query one video task. Download URLs stay on the returned object and are not logged.
 * @param transport - authenticated transport.
 * @param taskId - provider task id.
 * @param signal - caller lifetime.
 * @returns current task facts.
 */
export async function queryVideoTask(
  transport: MinimaxTransport,
  taskId: string,
  signal: AbortSignal,
): Promise<VideoTask> {
  if (taskId.trim() === '') {
    throw new MediaError('provider-invalid', 'video query requires a task id')
  }
  const doc = await jsonRequest(
    transport,
    'GET',
    `/v2/query/video_generation/${encodeURIComponent(taskId)}`,
    undefined,
    signal,
  )
  const raw = doc.task
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MediaError('provider-invalid', 'video query response omitted task')
  }
  const task = raw as Record<string, unknown>
  const status = task.status
  if (
    status !== 'queued' && status !== 'running' && status !== 'succeeded'
    && status !== 'failed' && status !== 'cancelled'
  ) {
    throw new MediaError('provider-invalid', 'video query returned an unknown status')
  }
  const id = typeof task.id === 'string' && task.id !== '' ? task.id : taskId
  const model = typeof task.model === 'string' ? task.model : ''
  const usage = task.usage !== null && typeof task.usage === 'object' && !Array.isArray(task.usage)
    ? task.usage as Record<string, unknown>
    : undefined
  const content = task.content !== null && typeof task.content === 'object' && !Array.isArray(task.content)
    ? task.content as Record<string, unknown>
    : undefined
  const downloadUrl = typeof content?.url === 'string' ? content.url : undefined
  const outputSeconds = typeof usage?.output_seconds === 'number' ? usage.output_seconds : undefined
  return {
    id,
    model,
    status,
    ...outputSeconds === undefined ? {} : { outputSeconds },
    ...downloadUrl === undefined ? {} : { downloadUrl },
  }
}

/**
 * Poll until a video task succeeds, fails, or the caller deadline elapses.
 * @param transport - authenticated transport.
 * @param taskId - provider task id.
 * @param signal - caller lifetime.
 * @param timing - poll interval and deadline.
 * @returns the succeeded task.
 */
export async function waitForVideoTask(
  transport: MinimaxTransport,
  taskId: string,
  signal: AbortSignal,
  timing: VideoWaitTiming,
): Promise<VideoTask> {
  if (timing.intervalMs < 1 || timing.timeoutMs < 1) {
    throw new MediaError('provider-invalid', 'video wait timing must be positive')
  }
  const deadline = transport.now() + timing.timeoutMs
  while (transport.now() < deadline) {
    const task = await queryVideoTask(transport, taskId, signal)
    if (task.status === 'succeeded') return task
    if (task.status === 'failed' || task.status === 'cancelled') {
      throw new MediaError('task-failed', `video task ${task.status}`)
    }
    await transport.sleep(timing.intervalMs, signal)
  }
  throw new MediaError('task-timeout', 'video task did not finish before the wait deadline')
}

/**
 * Run formal non-streaming TTS and decode hex audio.
 * @param transport - authenticated transport.
 * @param request - model, text, and voice.
 * @param signal - caller lifetime.
 * @returns audio bytes and billed character count.
 */
export async function synthesizeSpeech(
  transport: MinimaxTransport,
  request: SynthesizeSpeechRequest,
  signal: AbortSignal,
): Promise<SynthesizeSpeechResult> {
  if (request.text.trim() === '' || request.voiceId.trim() === '') {
    throw new MediaError('provider-invalid', 'speech synthesis requires text and a voice id')
  }
  const doc = await jsonRequest(transport, 'POST', 'v1/t2a_v2', {
    model: request.model,
    text: request.text,
    stream: false,
    output_format: 'hex',
    voice_setting: { voice_id: request.voiceId },
    audio_setting: { format: request.format ?? 'mp3' },
  }, signal)
  assertBaseResp(doc)
  const data = doc.data !== null && typeof doc.data === 'object' && !Array.isArray(doc.data)
    ? doc.data as Record<string, unknown>
    : undefined
  const hex = typeof data?.audio === 'string' ? data.audio : ''
  const extra = doc.extra_info !== null && typeof doc.extra_info === 'object' && !Array.isArray(doc.extra_info)
    ? doc.extra_info as Record<string, unknown>
    : undefined
  const usageCharacters = typeof extra?.usage_characters === 'number' ? extra.usage_characters : 0
  const durationMs = typeof extra?.audio_length === 'number' ? extra.audio_length : undefined
  return {
    audio: decodeHexAudio(hex),
    usageCharacters,
    ...durationMs === undefined ? {} : { durationMs },
  }
}

/**
 * Upload a local audio file for voice cloning.
 * @param transport - authenticated transport.
 * @param file - filename and bytes.
 * @param signal - caller lifetime.
 * @returns provider file id.
 */
export async function uploadVoiceCloneFile(
  transport: MinimaxTransport,
  file: VoiceCloneUpload,
  signal: AbortSignal,
): Promise<number> {
  if (file.bytes.byteLength === 0) {
    throw new MediaError('provider-invalid', 'voice-clone upload requires audio bytes')
  }
  const body = new FormData()
  body.append('purpose', 'voice_clone')
  body.append('file', new Blob([Buffer.from(file.bytes)]), file.filename)
  const doc = await jsonRequest(transport, 'POST', '/v1/files/upload', body, signal)
  assertBaseResp(doc)
  const uploaded = doc.file !== null && typeof doc.file === 'object' && !Array.isArray(doc.file)
    ? doc.file as Record<string, unknown>
    : undefined
  if (typeof uploaded?.file_id !== 'number') {
    throw new MediaError('provider-invalid', 'file upload response omitted file_id')
  }
  return uploaded.file_id
}

/**
 * Clone a voice from an uploaded file. Omits preview `text` so this call is not formal TTS.
 * @param transport - authenticated transport.
 * @param fileId - upload id.
 * @param voiceId - caller-generated MiniMax voice id.
 * @param signal - caller lifetime.
 */
export async function cloneVoice(
  transport: MinimaxTransport,
  fileId: number,
  voiceId: string,
  signal: AbortSignal,
): Promise<void> {
  if (!CLONE_VOICE_ID.test(voiceId)) {
    throw new MediaError('provider-invalid', 'voice_id failed MiniMax grammar')
  }
  const doc = await jsonRequest(transport, 'POST', '/v1/voice_clone', {
    file_id: fileId,
    voice_id: voiceId,
  }, signal)
  assertBaseResp(doc)
}

/**
 * Download one provider file to an absolute path. The URL is not copied into errors.
 * @param transport - authenticated transport.
 * @param url - time-limited provider URL.
 * @param destPath - absolute output path.
 * @param signal - caller lifetime.
 */
export async function downloadProviderFile(
  transport: MinimaxTransport,
  url: string,
  destPath: string,
  signal: AbortSignal,
): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    throw new MediaError('provider-invalid', 'download accepts only an http(s) URL')
  }
  if (!isAbsolute(destPath)) {
    throw new MediaError('path-not-absolute', 'download requires an absolute filesystem path')
  }
  let response: Response
  try {
    response = await transport.fetch(url, { signal })
  } catch {
    throw new MediaError('provider-http', 'provider download failed')
  }
  if (!response.ok) {
    throw new MediaError('provider-http', `provider download HTTP ${response.status}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength === 0) {
    throw new MediaError('provider-invalid', 'provider download returned an empty body')
  }
  await writeFile(destPath, bytes)
}

/**
 * Decode MiniMax hex-encoded audio.
 * @param hex - hex string from `data.audio`.
 * @returns audio bytes.
 */
export function decodeHexAudio(hex: string): Buffer {
  const trimmed = hex.trim()
  if (trimmed === '' || trimmed.length % 2 !== 0 || /[^0-9a-fA-F]/u.test(trimmed)) {
    throw new MediaError('provider-invalid', 'speech response omitted usable hex audio')
  }
  return Buffer.from(trimmed, 'hex')
}

const CLONE_VOICE_ID = /^[A-Za-z][A-Za-z0-9_-]{6,254}[A-Za-z0-9]$/

/**
 * Canonicalize an absolute MiniMax origin.
 * @param value - configured base URL.
 * @returns origin without a trailing slash.
 */
function resolveBaseUrl(value: string): string {
  const trimmed = value.trim()
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new MediaError('provider-invalid', 'MINIMAX_BASE_URL must be an absolute http(s) URL')
  }
  return trimmed.replace(/\/+$/u, '')
}

/**
 * Sleep that rejects when the caller aborts.
 * @param ms - delay.
 * @param signal - caller lifetime.
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * @param signal - aborted signal.
 * @returns the abort reason or a generic abort error.
 */
function abortError(signal: AbortSignal): unknown {
  return signal.reason
}

/**
 * POST or GET JSON. Multipart bodies skip a JSON Content-Type.
 * @param transport - authenticated transport.
 * @param method - HTTP method.
 * @param path - URL path.
 * @param body - JSON object, FormData, or omitted.
 * @param signal - caller lifetime.
 * @returns parsed object.
 */
async function jsonRequest(
  transport: MinimaxTransport,
  method: 'GET' | 'POST',
  path: string,
  body: Record<string, unknown> | FormData | undefined,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const headers = new Headers({
    Authorization: `Bearer ${transport.apiKey}`,
    Accept: 'application/json',
  })
  let payload: string | FormData | undefined
  if (body instanceof FormData) {
    payload = body
  } else if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
    payload = JSON.stringify(body)
  }
  let response: Response
  try {
    response = await transport.fetch(`${transport.baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
      method,
      headers,
      signal,
      ...payload === undefined ? {} : { body: payload },
    })
  } catch {
    throw new MediaError('provider-http', 'MiniMax request failed before a response')
  }
  const text = await response.text()
  const doc = parseObject(text)
  if (!response.ok) {
    throw new MediaError('provider-http', `MiniMax HTTP ${response.status}: ${errorDetail(doc)}`)
  }
  return doc
}

/**
 * Fail when MiniMax speech/file envelopes report a non-zero `base_resp`.
 * @param doc - parsed JSON object.
 */
function assertBaseResp(doc: Record<string, unknown>): void {
  const base = doc.base_resp
  if (base === undefined) return
  if (base === null || typeof base !== 'object' || Array.isArray(base)) {
    throw new MediaError('provider-invalid', 'MiniMax base_resp was not an object')
  }
  const status = (base as Record<string, unknown>).status_code
  if (status === undefined || status === 0) return
  const message = typeof (base as Record<string, unknown>).status_msg === 'string'
    ? (base as Record<string, unknown>).status_msg
    : 'request failed'
  throw new MediaError('provider-http', `MiniMax status ${String(status)}: ${redact(String(message))}`)
}

/**
 * Parse a JSON object or fail.
 * @param text - response body.
 * @returns object document.
 */
function parseObject(text: string): Record<string, unknown> {
  if (text.trim() === '') return {}
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new MediaError('provider-invalid', 'MiniMax returned non-JSON')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MediaError('provider-invalid', 'MiniMax returned a non-object JSON body')
  }
  return value as Record<string, unknown>
}

/**
 * Operator-facing error text without URLs or secrets.
 * @param doc - parsed error body.
 * @returns redacted detail.
 */
function errorDetail(doc: Record<string, unknown>): string {
  const err = doc.error
  if (err !== null && typeof err === 'object' && !Array.isArray(err)) {
    const message = (err as Record<string, unknown>).message
    if (typeof message === 'string' && message !== '') return redact(message)
  }
  if (typeof doc.message === 'string' && doc.message !== '') return redact(doc.message)
  return 'request failed'
}

/**
 * Strip URLs so signed download links never enter diagnostics.
 * @param value - provider text.
 * @returns redacted text.
 */
function redact(value: string): string {
  return value.replace(/https?:\/\/\S+/giu, '[redacted-url]')
}
