#!/usr/bin/env node
/**
 * Isolated conversion worker for AnyDoc native addon.
 * Runs in a private one-shot subprocess with validated file inputs and bounds.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/converter-worker
 */

import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

interface WorkerJobSpec {
  readonly protocol: 'file-result-v1'
  readonly jobId: string
  readonly inputPath: string
  readonly outputPath: string
  readonly format: string
  readonly maxOutputBytes?: number
}

async function run(): Promise<void> {
  const specArg = process.argv[2]
  let spec: WorkerJobSpec

  if (specArg) {
    const raw = await readFile(resolve(specArg), 'utf8')
    spec = JSON.parse(raw) as WorkerJobSpec
  } else {
    let input = ''
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) {
      input += chunk
    }
    spec = JSON.parse(input) as WorkerJobSpec
  }

  if (spec.protocol !== 'file-result-v1') {
    throw new Error(`Unsupported protocol: ${String(spec.protocol)}`)
  }

  if (typeof spec.jobId !== 'string' || !spec.jobId || typeof spec.inputPath !== 'string' ||
      typeof spec.outputPath !== 'string' || typeof spec.format !== 'string' ||
      (spec.maxOutputBytes !== undefined && (
        !Number.isSafeInteger(spec.maxOutputBytes) || spec.maxOutputBytes <= 0 || spec.maxOutputBytes > 50 * 1024 * 1024
      ))) {
    throw new Error('Invalid converter job fields')
  }
  const inputStat = await stat(spec.inputPath)
  if (!inputStat.isFile() || inputStat.size > 50 * 1024 * 1024) throw new Error('Invalid or oversized converter input')
  const maxBytes = spec.maxOutputBytes ?? 50 * 1024 * 1024

  // Attempt dynamic import of @firecrawl/anydoc
  let anydocModule: { toMarkdown: (path: string, options: { ocr: 'reject' }) => Promise<string> } | null = null
  let loadError: string | null = null
  try {
    // Dynamic import to prevent companion Host or Client bundle coupling
    const modName: string = '@firecrawl/anydoc'
    const loaded: unknown = await import(modName)
    if (typeof loaded !== 'object' || loaded === null || !('toMarkdown' in loaded) || typeof loaded.toMarkdown !== 'function') {
      throw new Error('AnyDoc export toMarkdown is missing')
    }
    const convert = loaded.toMarkdown
    anydocModule = { toMarkdown: async (path, options) => {
      const output: unknown = await convert(path, options)
      if (typeof output !== 'string') throw new Error('AnyDoc returned non-text output')
      return output
    } }
  } catch (err) {
    loadError = (err as Error).message
  }

  let resultPayload: Record<string, unknown>

  if (!anydocModule) {
    // Module not installed or architecture mismatch
    resultPayload = {
      ok: false,
      status: 'unsupported',
      format: spec.format,
      error: `Native module '@firecrawl/anydoc' is not installed: ${loadError ?? 'unknown error'}`,
      code: 'missing_native_module',
      markdown: '',
      blocks: [],
      diagnostics: {
        warnings: [`Native module '@firecrawl/anydoc' is unavailable: ${loadError ?? 'not installed'}`],
        omissions: ['entire document'],
        unsupportedFeatures: ['native converter'],
      },
    }
  } else {
    try {
      const markdown = await anydocModule.toMarkdown(spec.inputPath, { ocr: 'reject' })
      const norm = typeof markdown === 'string' ? markdown.normalize('NFKC') : ''

      if (Buffer.byteLength(norm, 'utf8') > maxBytes) {
        resultPayload = {
          ok: false,
          status: 'failed',
          format: spec.format,
          error: `Output exceeds maximum allowed size of ${maxBytes} bytes`,
          markdown: '',
          blocks: [],
          diagnostics: {
            warnings: ['output size limit exceeded'],
            omissions: ['entire document'],
            unsupportedFeatures: [],
          },
        }
      } else {
        const paragraphs = norm.split(/\n\s*\n/).map((p: string) => p.trim()).filter(Boolean)
        let offset = 0
        const blocks = paragraphs.map((p: string, idx: number) => {
          const charOffset = norm.indexOf(p, offset)
          offset = charOffset + p.length
          return ({
            id: `b${idx + 1}`,
            kind: p.startsWith('#') ? 'heading' : (p.startsWith('|') ? 'table' : 'paragraph'),
            text: p,
            locator: { blockIndex: idx + 1 },
            charOffset,
          }) })

        resultPayload = {
          ok: true,
          status: 'complete',
          format: spec.format,
          markdown: norm,
          blocks,
          diagnostics: {
            warnings: [],
            omissions: [],
            unsupportedFeatures: [],
          },
        }
      }
    } catch (convErr) {
      const errMsg = (convErr as Error).message
      const isNeedsOcr = errMsg.toLowerCase().includes('ocr') || errMsg.toLowerCase().includes('imagebased')
      resultPayload = {
        ok: false,
        status: isNeedsOcr ? 'needs_ocr' : 'failed',
        format: spec.format,
        error: errMsg,
        markdown: '',
        blocks: [],
        diagnostics: {
          warnings: [errMsg],
          omissions: ['entire document'],
          unsupportedFeatures: isNeedsOcr ? ['optical character recognition'] : [],
        },
      }
    }
  }

  // Write output file
  const jsonContent = JSON.stringify(resultPayload, null, 2)
  await writeFile(spec.outputPath, jsonContent, { encoding: 'utf8', mode: 0o600, flag: 'wx' })

  // Compute SHA-256 of output file
  const outStat = await stat(spec.outputPath)
  const sha256 = createHash('sha256').update(jsonContent).digest('hex')

  // Output file-result-v1 envelope to stdout
  const envelope = {
    protocol: 'file-result-v1',
    jobId: spec.jobId,
    resultPath: spec.outputPath,
    sha256,
    byteLength: outStat.size,
    status: resultPayload.status,
    ok: resultPayload.ok === true,
  }

  process.stdout.write(JSON.stringify(envelope) + '\n')
}

run().catch((err) => {
  process.stderr.write(`converter-worker fatal error: ${(err as Error).stack ?? err}\n`)
  process.exit(1)
})
