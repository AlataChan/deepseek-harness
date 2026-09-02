/** Session-only extract: convert-file, no catalog write, character cap. */

import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { AskKnowledgeError, ASK_KNOWLEDGE_EXTRACT_MAX_CHARS } from '@deepseek-ai/dsh-host-ask-knowledge'
import type { AskKnowledge } from '@deepseek-ai/dsh-host-ask-knowledge'
import { clipExtractText } from '../src/extract.ts'
import { parseExtractFilename } from '../src/upload-temp.ts'
import { catalogPath } from '../src/catalog.ts'
import { writeFakeSidecarEnv } from './helpers/install-sidecar.ts'
import { bootOverlay } from './helpers/boot.ts'

const cleanups: Array<() => void | Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function extractText(capability: AskKnowledge, filename: string, body: string) {
  const handle = await capability.beginExtract({ filename })
  const bytes = Buffer.from(body, 'utf8').toString('base64')
  await capability.appendExtractChunk({ handle, bytes })
  return capability.finishExtract({ handle })
}

async function extractBytes(capability: AskKnowledge, filename: string, body: Uint8Array) {
  const handle = await capability.beginExtract({ filename })
  await capability.appendExtractChunk({ handle, bytes: Buffer.from(body).toString('base64') })
  return capability.finishExtract({ handle })
}

function docxWithParagraphs(paragraphs: readonly string[]): Uint8Array {
  const body = paragraphs.map(text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  return zipSync({ 'word/document.xml': strToU8(xml) })
}

describe('session-only extract', () => {
  it('clips at the extract character cap', () => {
    expect(clipExtractText('短')).toEqual({ text: '短', truncated: false })
    const long = '字'.repeat(ASK_KNOWLEDGE_EXTRACT_MAX_CHARS + 2)
    const clipped = clipExtractText(long)
    expect(clipped.truncated).toBe(true)
    expect([...clipped.text]).toHaveLength(ASK_KNOWLEDGE_EXTRACT_MAX_CHARS)
  })

  it('rejects spreadsheets and accepts session document suffixes', () => {
    expect(parseExtractFilename('制度.pdf')).toEqual({ basename: '制度.pdf', extension: '.pdf' })
    expect(parseExtractFilename('制度.docx')).toEqual({ basename: '制度.docx', extension: '.docx' })
    expect(() => parseExtractFilename('表.xlsx')).toThrow(AskKnowledgeError)
    expect(() => parseExtractFilename('../x.md')).toThrow(AskKnowledgeError)
  })

  it('returns markdown and leaves catalog.json unchanged', async () => {
    const started = await bootOverlay()
    cleanups.push(() => started.fiber.dispose())
    const { ctx, root } = started
    const before = await ctx.askKnowledge.listLibraries()
    const result = await extractText(ctx.askKnowledge, '报销.md', '# 报销\n\n流程\n')
    expect(result).toEqual({
      filename: '报销.md',
      text: '# 报销\n\n流程\n',
      truncated: false,
    })
    expect(await ctx.askKnowledge.listLibraries()).toEqual(before)
    await expect(readFile(catalogPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an unknown extract handle and a spreadsheet name', async () => {
    const started = await bootOverlay()
    cleanups.push(() => started.fiber.dispose())
    const { ctx } = started
    await expect(ctx.askKnowledge.finishExtract({ handle: 'gone' as never }))
      .rejects.toMatchObject({ code: 'ingest-failed', message: 'unknown extract handle' })
    await expect(ctx.askKnowledge.beginExtract({ filename: '表.xlsx' }))
      .rejects.toMatchObject({ code: 'type-unsupported' })
    const aborted = AbortSignal.abort()
    await expect(ctx.askKnowledge.beginExtract({ filename: 'a.md' }, aborted)).rejects.toThrow()
    await expect(ctx.askKnowledge.appendExtractChunk({
      handle: 'gone' as never,
      bytes: 'YQ==',
    }, aborted)).rejects.toThrow()
    await expect(ctx.askKnowledge.finishExtract({ handle: 'gone' as never }, aborted)).rejects.toThrow()
  })

  it('surfaces an empty convert-file as a session-attachment failure', async () => {
    const started = await bootOverlay()
    cleanups.push(() => started.fiber.dispose())
    await writeFakeSidecarEnv(started.sidecarHome, { ASK_KNOWLEDGE_FAKE_CONVERT_EMPTY: '1' })
    await expect(extractText(started.ctx.askKnowledge, '扫描.pdf', '%PDF-1.4'))
      .rejects.toMatchObject({
        code: 'ingest-failed',
        message: '这份 PDF 没有可提取的文字。扫描件还不能作为会话附件。',
      })
  })

  it('rejects a blank convert-file body after ok', async () => {
    const started = await bootOverlay()
    cleanups.push(() => started.fiber.dispose())
    await writeFakeSidecarEnv(started.sidecarHome, { ASK_KNOWLEDGE_FAKE_CONVERT_BLANK: '1' })
    await expect(extractText(started.ctx.askKnowledge, 'empty.md', '# title\n'))
      .rejects.toMatchObject({
        code: 'ingest-failed',
        message: '这份文件没有可提取的文字。',
      })
  })

  it('truncates a huge convert-file body', async () => {
    const started = await bootOverlay()
    cleanups.push(() => started.fiber.dispose())
    await writeFakeSidecarEnv(started.sidecarHome, { ASK_KNOWLEDGE_FAKE_CONVERT_HUGE: '1' })
    const result = await extractText(started.ctx.askKnowledge, 'long.md', '# short\n')
    expect(result.truncated).toBe(true)
    expect([...result.text]).toHaveLength(ASK_KNOWLEDGE_EXTRACT_MAX_CHARS)
  })

  it('extracts Word paragraphs without convert-file', async () => {
    const started = await bootOverlay()
    cleanups.push(() => started.fiber.dispose())
    await expect(extractBytes(started.ctx.askKnowledge, '制度.docx', docxWithParagraphs(['报销流程', '第二段'])))
      .resolves.toEqual({
        filename: '制度.docx',
        text: '报销流程\n第二段',
        truncated: false,
      })
    await expect(extractBytes(started.ctx.askKnowledge, '空.docx', docxWithParagraphs([])))
      .rejects.toMatchObject({
        code: 'ingest-failed',
        message: '这份 Word 没有可提取的文字',
      })
    const clipped = await extractBytes(
      started.ctx.askKnowledge,
      '长.docx',
      docxWithParagraphs(['字'.repeat(ASK_KNOWLEDGE_EXTRACT_MAX_CHARS + 2)]),
    )
    expect(clipped.truncated).toBe(true)
    expect([...clipped.text]).toHaveLength(ASK_KNOWLEDGE_EXTRACT_MAX_CHARS)
  })

  it('surfaces a sidecar convert-file failure', async () => {
    const started = await bootOverlay()
    cleanups.push(() => started.fiber.dispose())
    await writeFakeSidecarEnv(started.sidecarHome, { ASK_KNOWLEDGE_FAKE_CONVERT_FAIL: '1' })
    await expect(extractText(started.ctx.askKnowledge, '坏.pdf', '%PDF-1.4'))
      .rejects.toMatchObject({
        code: 'ingest-failed',
        message: 'convert failed',
      })
  })

  it('rejects an ok convert-file that omitted the body', async () => {
    const started = await bootOverlay()
    cleanups.push(() => started.fiber.dispose())
    await writeFakeSidecarEnv(started.sidecarHome, { ASK_KNOWLEDGE_FAKE_CONVERT_NO_BODY: '1' })
    await expect(extractText(started.ctx.askKnowledge, 'note.md', '# title\n'))
      .rejects.toMatchObject({
        code: 'ingest-failed',
        message: '这份文件没有可提取的文字。',
      })
  })
})
