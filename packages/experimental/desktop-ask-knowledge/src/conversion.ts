/**
/**
 * Normalized document conversion, block extraction, and completeness diagnostics.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/conversion
 */

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'
import { parseWorkerConversion, runAnyDocWorker } from './converters/anydoc.ts'
import { extractDocxBytes, isDocxExtractFilename } from './extract-docx.ts'
import type { AskKnowledgeHomeConfig } from './knowledge-home.ts'
import { runSidecar } from './sidecar.ts'

/** Supported conversion status states. */
export type ConversionStatus =
  | 'complete'
  | 'partial'
  | 'needs_ocr'
  | 'unsupported'
  | 'failed'
  | 'unknown'

/** Structural block kinds. */
export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'table'
  | 'quote'
  | 'code'
  | 'footnote'
  | 'other'

/** Normalized block with stable locator and character offset. */
export interface NormalizedBlock {
  readonly id: string
  readonly kind: BlockKind
  readonly text: string
  readonly level?: number
  readonly page?: number
  readonly locator?: {
    page?: number
    blockIndex?: number
    section?: string
    row?: number
    col?: number
    sheet?: string
    noteId?: string
  }
  readonly charOffset: number
}

/** Diagnostics and omissions recorded during conversion. */
export interface ConversionDiagnostics {
  readonly warnings: readonly string[]
  readonly omissions: readonly string[]
  readonly unsupportedFeatures: readonly string[]
  readonly needsOcrPages?: readonly number[] | undefined
  readonly totalPages?: number | undefined
  readonly decoding?: string | undefined
  readonly nativeDiagnostic?: string | undefined
}

/** Normalized conversion result. */
export interface ConversionResult {
  readonly status: ConversionStatus
  readonly format: string
  readonly markdown: string
  readonly blocks: readonly NormalizedBlock[]
  readonly diagnostics: ConversionDiagnostics
  readonly sha256: string
  readonly byteLength: number
  readonly error?: string | undefined
}

/** Maximum allowed output size (50 MiB). */
export const MAX_CONVERT_OUTPUT_BYTES = 50 * 1024 * 1024

/**
 * Normalize Unicode text (NFKC) preserving Chinese radicals and characters.
 * @param text - raw input text.
 * @returns normalized text.
 */
export function normalizeText(text: string): string {
  return text.normalize('NFKC')
}

/**
 * Split markdown text into structural blocks.
 * @param markdown - normalized markdown content.
 * @param baseOffset - starting character offset.
 * @returns list of normalized blocks.
 */
export function splitMarkdownIntoBlocks(markdown: string, baseOffset = 0): NormalizedBlock[] {
  const rawLines = markdown.split(/\r?\n/)
  const rawChunks: string[] = []
  let tableBuffer: string[] = []
  let textBuffer: string[] = []

  const flushTable = () => {
    if (tableBuffer.length > 0) {
      rawChunks.push(tableBuffer.join('\n'))
      tableBuffer = []
    }
  }

  const flushText = () => {
    if (textBuffer.length > 0) {
      rawChunks.push(textBuffer.join('\n'))
      textBuffer = []
    }
  }

  for (const line of rawLines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('|')) {
      flushText()
      tableBuffer.push(trimmed)
    } else if (trimmed === '') {
      flushTable()
      flushText()
    } else {
      flushTable()
      textBuffer.push(trimmed)
    }
  }
  flushTable()
  flushText()

  const paragraphs = rawChunks.map(p => p.trim()).filter(Boolean)
  const blocks: NormalizedBlock[] = []
  let offset = baseOffset

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    if (!p) continue
    let kind: BlockKind = 'paragraph'
    let level: number | undefined

    if (p.startsWith('#')) {
      kind = 'heading'
      const match = p.match(/^(#+)/)
      level = match?.[1] ? match[1].length : 1
    } else if (p.startsWith('- ') || p.startsWith('* ') || /^\d+\.\s/.test(p)) {
      kind = 'list'
    } else if (p.startsWith('|') && p.includes('---')) {
      kind = 'table'
    } else if (p.startsWith('>')) {
      kind = 'quote'
    } else if (p.startsWith('```')) {
      kind = 'code'
    } else if (p.startsWith('[^') && p.includes(']:')) {
      kind = 'footnote'
    }

    blocks.push({
      id: `b${i + 1}`,
      kind,
      text: p,
      ...level !== undefined ? { level } : {},
      locator: { blockIndex: i + 1 },
      charOffset: offset,
    })

    offset += p.length + 2
  }

  return blocks
}

/**
 * Convert source file to normalized markdown, blocks, and diagnostics.
 * @param config - sidecar home config.
 * @param inputPath - path to original source file.
 * @param filename - original filename.
 * @param options - conversion options.
 * @returns conversion result.
 */
export async function convertSourceFile(
  config: AskKnowledgeHomeConfig,
  inputPath: string,
  filename: string,
  options: {
    maxBytes?: number
    signal?: AbortSignal
    preferWorker?: boolean
  } = {},
): Promise<ConversionResult> {
  if (options.signal?.aborted) throw new AskKnowledgeError('ingest-failed', 'conversion was aborted')
  const fileStat = await stat(inputPath).catch(() => null)
  if (!fileStat || !fileStat.isFile()) {
    throw new AskKnowledgeError('ingest-failed', `Source file not found: ${inputPath}`)
  }

  const ext = extname(filename).toLowerCase()
  const maxBytes = options.maxBytes ?? MAX_CONVERT_OUTPUT_BYTES

  // Unsupported legacy Office and OpenDocument formats
  const legacyFormats = new Set(['.doc', '.ppt', '.xls', '.odt', '.ods', '.odp'])
  if (legacyFormats.has(ext)) {
    return {
      status: 'unsupported',
      format: ext.replace('.', ''),
      markdown: '',
      blocks: [],
      diagnostics: {
        warnings: [`Format '${ext}' is not supported. Please convert to modern OpenXML (.docx, .pptx, .xlsx) or PDF.`],
        omissions: ['entire document'],
        unsupportedFeatures: [`legacy format ${ext}`],
      },
      sha256: createHash('sha256').update('').digest('hex'),
      byteLength: 0,
      error: `Format '${ext}' is unsupported`,
    }
  }

  // 1. Text & Markdown
  if (ext === '.md' || ext === '.txt') {
    const raw = await readFile(inputPath)
    if (raw.byteLength > maxBytes) {
      throw new AskKnowledgeError('ingest-failed', `File size ${raw.byteLength} exceeds maximum allowed ${maxBytes} bytes`)
    }

    let text: string
    let decoding = 'utf-8'
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(raw)
    } catch {
      try {
        text = new TextDecoder('utf-16le', { fatal: true }).decode(raw)
        decoding = 'utf-16le'
      } catch {
        text = new TextDecoder('utf-8', { fatal: false }).decode(raw)
        decoding = 'utf-8-replacement'
      }
    }

    const norm = normalizeText(text)
    const blocks = splitMarkdownIntoBlocks(norm)
    const sha256 = createHash('sha256').update(norm).digest('hex')

    return {
      status: 'complete',
      format: ext.replace('.', ''),
      markdown: norm,
      blocks,
      diagnostics: {
        warnings: decoding === 'utf-8-replacement' ? ['File decoded with replacement characters'] : [],
        omissions: [],
        unsupportedFeatures: [],
        decoding,
      },
      sha256,
      byteLength: Buffer.byteLength(norm, 'utf8'),
    }
  }

  // 2. JSON
  if (ext === '.json') {
    const raw = await readFile(inputPath, 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      throw new AskKnowledgeError('ingest-failed', `Invalid JSON: ${(err as Error).message}`)
    }
    const formatted = JSON.stringify(parsed, null, 2)
    const markdown = `\`\`\`json\n${formatted}\n\`\`\``
    const sha256 = createHash('sha256').update(markdown).digest('hex')
    return {
      status: 'complete',
      format: 'json',
      markdown,
      blocks: [
        {
          id: 'b1',
          kind: 'code',
          text: markdown,
          locator: { blockIndex: 1 },
          charOffset: 0,
        },
      ],
      diagnostics: {
        warnings: [],
        omissions: [],
        unsupportedFeatures: [],
      },
      sha256,
      byteLength: Buffer.byteLength(markdown, 'utf8'),
    }
  }

  // 3. DOCX: Try AnyDoc worker or fallback to native JS extractor
  if (isDocxExtractFilename(filename)) {
    if (options.preferWorker !== false) {
      try {
        const workerResult = await runAnyDocWorker(config, {
          inputPath,
          format: 'docx',
          maxOutputBytes: maxBytes,
          signal: options.signal,
        })
        if (workerResult.status !== 'failed' && workerResult.status !== 'unsupported' && workerResult.markdown.trim() !== '') {
          return workerResult
        }
      } catch (workerError) {
        if (options.signal?.aborted) throw new AskKnowledgeError('ingest-failed', 'conversion was aborted')
        // Explicit partial fallback below preserves text when native conversion is unavailable.
        void workerError
      }
    }

    const raw = await readFile(inputPath)
    const text = extractDocxBytes(new Uint8Array(raw))
    if (text.trim() === '') {
      throw new AskKnowledgeError('ingest-failed', '这份 Word 没有可提取的文字')
    }
    const norm = normalizeText(text)
    const blocks = splitMarkdownIntoBlocks(norm)
    const sha256 = createHash('sha256').update(norm).digest('hex')

    return {
      status: 'partial',
      format: 'docx',
      markdown: norm,
      blocks,
      diagnostics: {
        warnings: [],
        omissions: ['headers and footers'],
        unsupportedFeatures: ['header/footer omission'],
      },
      sha256,
      byteLength: Buffer.byteLength(norm, 'utf8'),
    }
  }

  // 4. PPTX: Try AnyDoc worker
  if (ext === '.pptx') {
    try {
      return await runAnyDocWorker(config, {
        inputPath,
        format: 'pptx',
        maxOutputBytes: maxBytes,
        signal: options.signal,
      })
    } catch (err) {
      if (options.signal?.aborted) throw new AskKnowledgeError('ingest-failed', 'conversion was aborted')
      return {
        status: 'unsupported',
        format: 'pptx',
        markdown: '',
        blocks: [],
        diagnostics: {
          warnings: [`PPTX converter unavailable: ${(err as Error).message}`],
          omissions: ['entire presentation'],
          unsupportedFeatures: ['pptx native converter missing'],
        },
        sha256: createHash('sha256').update('').digest('hex'),
        byteLength: 0,
        error: (err as Error).message,
      }
    }
  }

  // 5. PDF, CSV, XLSX, etc. via sidecar convert-document
  const sidecarResult = await runSidecar(config, {
    command: 'convert-document',
    path: inputPath,
    maxOutputBytes: maxBytes,
  }, { signal: options.signal, timeoutMs: 90_000 })

  if (sidecarResult.ok !== true) {
    throw new AskKnowledgeError('ingest-failed', String(sidecarResult.error ?? 'conversion failed'))
  }

  if (options.signal?.aborted) throw new AskKnowledgeError('ingest-failed', 'conversion was aborted')
  return parseWorkerConversion(sidecarResult, ext.replace('.', ''))
}
