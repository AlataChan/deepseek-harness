/**
 * Host unzip of `.docx` for session extract and knowledge ingest: read `word/document.xml` and collect `w:t`.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/extract-docx
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'

/** Uncompressed cap for `word/document.xml`. */
const MAX_DOCX_ENTRY_BYTES = 8 * 1024 * 1024

/**
 * Whether this upload is a Word file the Host unzips itself.
 * @param filename - original basename.
 * @returns true when the suffix is `.docx`.
 */
export function isDocxExtractFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith('.docx')
}

/**
 * Decode the XML entities Word emits in `w:t`.
 * @param text - raw element body.
 * @returns decoded text.
 */
function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Turn WordprocessingML into plain paragraphs.
 * @param xml - `word/document.xml`.
 * @returns newline-joined paragraph text.
 */
export function wordXmlToText(xml: string): string {
  const paragraphs: string[] = []
  const paraRe = /<(?:[\w.-]+:)?p\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?p>/gi
  let para: RegExpExecArray | null
  while ((para = paraRe.exec(xml)) !== null) {
    const texts: string[] = []
    const tRe = /<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t>/gi
    let node: RegExpExecArray | null
    const inner = para[1] as string
    while ((node = tRe.exec(inner)) !== null) {
      texts.push(decodeXml(node[1] as string))
    }
    const line = texts.join('')
    if (line.trim() !== '') paragraphs.push(line)
  }
  return paragraphs.join('\n')
}

/**
 * Unzip document.xml from a materialized .docx and return its text.
 * @param bytes - assembled upload bytes.
 * @returns newline-joined paragraph text.
 */
export function extractDocxBytes(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter: (entry) => {
        /* v8 ignore next 3 -- an 8MiB uncompressed document.xml is too large to allocate in unit tests */
        if (entry.originalSize > MAX_DOCX_ENTRY_BYTES) {
          throw new Error('docx-too-large')
        }
        return entry.name.replace(/\\/g, '/') === 'word/document.xml'
      },
    })
  } catch (error) {
    /* v8 ignore next 3 -- zip-bomb branch is paired with the ignored size check */
    if (error instanceof Error && error.message === 'docx-too-large') {
      throw new AskKnowledgeError('ingest-failed', '这份 Word 太大，读不了')
    }
    throw new AskKnowledgeError('ingest-failed', '读不了这份 Word 文件')
  }
  const xmlBytes = files['word/document.xml']
  if (xmlBytes === undefined) {
    throw new AskKnowledgeError('ingest-failed', '这份 Word 没有可提取的文字')
  }
  return wordXmlToText(strFromU8(xmlBytes))
}

/**
 * Unzip a materialized `.docx` and write `{stem}.md` so sidecar `ingest-file` copies markdown.
 * Other filenames return `input.path` unchanged.
 * @param input - assembled upload path, temp directory, and original basename.
 * @returns path sidecar `ingest-file` should read.
 */
export async function writeDocxMarkdownForIngest(input: {
  path: string
  dir: string
  filename: string
}): Promise<string> {
  if (!isDocxExtractFilename(input.filename)) return input.path
  const text = extractDocxBytes(new Uint8Array(await readFile(input.path)))
  if (text.trim() === '') {
    throw new AskKnowledgeError('ingest-failed', '这份 Word 没有可提取的文字')
  }
  const dot = input.filename.lastIndexOf('.')
  const stem = (dot > 0 ? input.filename.slice(0, dot) : '').trim()
  const mdPath = join(input.dir, `${stem === '' ? 'document' : stem}.md`)
  await writeFile(mdPath, `${text}\n`, 'utf8')
  return mdPath
}
