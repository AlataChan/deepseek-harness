/** Isolated, network-confined AnyDoc execution with bounded file results. */

import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'
import type { ConversionDiagnostics, ConversionResult, ConversionStatus, NormalizedBlock, BlockKind } from '../conversion.ts'
import { validateFileResult } from '../document-jobs.ts'
import type { AskKnowledgeHomeConfig } from '../knowledge-home.ts'
import { withKnowledgeProcessRunner } from '../sidecar.ts'

/** Limits and cancellation for one native conversion. */
export interface AnyDocWorkerOptions {
  readonly inputPath: string
  readonly format: string
  readonly maxOutputBytes?: number | undefined
  readonly timeoutMs?: number | undefined
  readonly signal?: AbortSignal | undefined
}

/**
 * Apply an operating-system network prohibition or refuse native conversion.
 * @param argv - native worker command.
 * @returns enforcing argv; Windows is deferred until an enforcing runner exists.
 */
export function offlineConverterArgv(argv: readonly string[]): string[] {
  if (process.platform === 'darwin') {
    return ['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)(deny network*)', ...argv]
  }
  if (process.platform === 'linux') return ['unshare', '--net', '--', ...argv]
  throw new AskKnowledgeError('ingest-failed', 'Native document conversion is unavailable: network confinement is not implemented on this platform')
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new AskKnowledgeError('ingest-failed', 'Invalid converter diagnostics')
  }
  return value
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AskKnowledgeError('ingest-failed', 'Invalid converter object')
  }
  return value as Record<string, unknown>
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AskKnowledgeError('ingest-failed', 'Invalid numeric converter metadata')
  }
  return value
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new AskKnowledgeError('ingest-failed', 'Invalid converter text metadata')
  return value
}

function parseLocator(value: unknown): NonNullable<NormalizedBlock['locator']> {
  const input = record(value)
  const locator: NonNullable<NormalizedBlock['locator']> = {}
  for (const key of ['page', 'blockIndex', 'row', 'col'] as const) {
    const number = optionalNumber(input[key])
    if (number !== undefined) locator[key] = number
  }
  for (const key of ['section', 'sheet', 'noteId'] as const) {
    const text = optionalString(input[key])
    if (text !== undefined) locator[key] = text
  }
  return locator
}

function parseDiagnostics(value: unknown): ConversionDiagnostics {
  const input = record(value)
  const totalPages = optionalNumber(input.totalPages)
  const decoding = optionalString(input.decoding)
  const nativeDiagnostic = optionalString(input.nativeDiagnostic)
  let needsOcrPages: number[] | undefined
  if (input.needsOcrPages !== undefined) {
    if (!Array.isArray(input.needsOcrPages)) throw new AskKnowledgeError('ingest-failed', 'Invalid OCR page list')
    needsOcrPages = input.needsOcrPages.map((page: unknown) => {
      const number = optionalNumber(page)
      if (number === undefined) throw new AskKnowledgeError('ingest-failed', 'Missing OCR page number')
      return number
    })
  }
  return {
    warnings: strings(input.warnings ?? []),
    omissions: strings(input.omissions ?? []),
    unsupportedFeatures: strings(input.unsupportedFeatures ?? []),
    ...totalPages === undefined ? {} : { totalPages },
    ...needsOcrPages === undefined ? {} : { needsOcrPages },
    ...decoding === undefined ? {} : { decoding },
    ...nativeDiagnostic === undefined ? {} : { nativeDiagnostic },
  }
}

/**
 * Validate normalized result data received across the private worker channel.
 * @param payload - parsed, bounded worker result.
 * @param format - requested input format.
 * @returns validated conversion result.
 */
export function parseWorkerConversion(payload: Record<string, unknown>, format: string): ConversionResult {
  const statuses: readonly ConversionStatus[] = ['complete', 'partial', 'needs_ocr', 'unsupported', 'failed', 'unknown']
  if (!statuses.some(status => status === payload.status) || typeof payload.markdown !== 'string' || !Array.isArray(payload.blocks)) {
    throw new AskKnowledgeError('ingest-failed', 'Invalid converter result fields')
  }
  const kinds: readonly BlockKind[] = ['heading', 'paragraph', 'list', 'table', 'quote', 'code', 'footnote', 'other']
  const blocks: NormalizedBlock[] = payload.blocks.map((value: unknown) => {
    if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string' ||
        !('text' in value) || typeof value.text !== 'string' || !('kind' in value) || !kinds.some(kind => kind === value.kind) ||
        !('charOffset' in value) || typeof value.charOffset !== 'number' || !Number.isSafeInteger(value.charOffset) || value.charOffset < 0) {
      throw new AskKnowledgeError('ingest-failed', 'Invalid normalized converter block')
    }
    const metadata = record(value)
    const level = optionalNumber(metadata.level)
    const page = optionalNumber(metadata.page)
    const locator = metadata.locator === undefined ? undefined : parseLocator(metadata.locator)
    return {
      id: value.id, text: value.text, kind: value.kind as BlockKind, charOffset: value.charOffset,
      ...level === undefined ? {} : { level },
      ...page === undefined ? {} : { page },
      ...locator === undefined ? {} : { locator },
    }
  })
  return {
    status: payload.status as ConversionStatus,
    format,
    markdown: payload.markdown,
    blocks,
    diagnostics: parseDiagnostics(payload.diagnostics),
    sha256: createHash('sha256').update(payload.markdown).digest('hex'),
    byteLength: Buffer.byteLength(payload.markdown, 'utf8'),
    error: typeof payload.error === 'string' ? payload.error : undefined,
  }
}

/**
 * Run a disposable native converter; abort, timeout and unload join its managed range.
 * @param config - service-owned subprocess capability.
 * @param options - input, output bounds and caller lifetime.
 * @returns validated conversion result.
 */
export async function runAnyDocWorker(config: AskKnowledgeHomeConfig, options: AnyDocWorkerOptions): Promise<ConversionResult> {
  if (options.signal?.aborted) throw new AskKnowledgeError('ingest-failed', 'native conversion was aborted')
  const jobDir = await mkdtemp(join(tmpdir(), 'dsh-converter-'))
  const specPath = join(jobDir, 'spec.json')
  const outputPath = join(jobDir, 'result.json')
  const jobId = `anydoc-${randomUUID()}`
  const currentDir = dirname(fileURLToPath(import.meta.url))
  const tsWorker = join(currentDir, '..', 'converter-worker.ts')
  const sourceJsWorker = join(currentDir, '..', '..', 'lib', 'converter-worker.js')
  // Host bundling puts import.meta.url beside converter-worker.js.
  const bundledJsWorker = join(currentDir, 'converter-worker.js')
  const workerScript = existsSync(tsWorker) ? tsWorker : existsSync(bundledJsWorker) ? bundledJsWorker : sourceJsWorker
  const args = workerScript.endsWith('.ts') ? ['--import', import.meta.resolve('tsx/esm'), workerScript, specPath] : [workerScript, specPath]
  try {
    await writeFile(specPath, JSON.stringify({
      protocol: 'file-result-v1', jobId, inputPath: options.inputPath, outputPath,
      format: options.format, maxOutputBytes: options.maxOutputBytes ?? 50 * 1024 * 1024,
    }), { mode: 0o600 })
    return await withKnowledgeProcessRunner(config, async (runner) => {
      const output = await runner.run({
        argv: offlineConverterArgv([process.execPath, ...args]), cwd: jobDir,
        signal: options.signal, timeoutMs: options.timeoutMs ?? 60_000,
      })
      const envelope: unknown = JSON.parse(output.stdout.trim())
      if (typeof envelope !== 'object' || envelope === null || !('protocol' in envelope) || envelope.protocol !== 'file-result-v1' ||
          !('resultPath' in envelope) || envelope.resultPath !== outputPath || !('sha256' in envelope) || typeof envelope.sha256 !== 'string' ||
          !('jobId' in envelope) || envelope.jobId !== jobId) {
        throw new AskKnowledgeError('ingest-failed', 'Invalid native converter envelope')
      }
      const payload = await validateFileResult(jobDir, outputPath, envelope.sha256, options.maxOutputBytes ?? 50 * 1024 * 1024)
      return parseWorkerConversion(payload, options.format)
    })
  } finally {
    await rm(jobDir, { recursive: true, force: true })
  }
}
