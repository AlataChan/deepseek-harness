/** Host Word extract: unzip document.xml and collect w:t. */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'
import {
  extractDocxBytes, isDocxExtractFilename, wordXmlToText, writeDocxMarkdownForIngest,
} from '../src/extract-docx.ts'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function docxBytes(xml: string): Uint8Array {
  return zipSync({ 'word/document.xml': strToU8(xml) })
}

describe('extract-docx', () => {
  it('recognizes Word extract names', () => {
    expect(isDocxExtractFilename('制度.DOCX')).toBe(true)
    expect(isDocxExtractFilename('制度.pdf')).toBe(false)
  })

  it('joins Word paragraphs and decodes entities', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NS}">
  <w:body>
    <w:p><w:r><w:t></w:t><w:t>报销</w:t><w:t>流程</w:t></w:r></w:p>
    <w:p><w:r><w:t>  </w:t></w:r></w:p>
    <w:p><w:r><w:t>A&amp;B&lt;C&gt;&quot;D&apos;</w:t></w:r></w:p>
  </w:body>
</w:document>`
    expect(wordXmlToText(xml)).toBe('报销流程\nA&B<C>"D\'')
    expect(extractDocxBytes(docxBytes(xml))).toBe('报销流程\nA&B<C>"D\'')
  })

  it('reads a default-namespace document', () => {
    expect(wordXmlToText(
      `<document xmlns="${WORD_NS}"><body><p><r><t>制度</t></r></p></body></document>`,
    )).toBe('制度')
  })

  it('rejects a non-zip and a zip without document.xml', () => {
    expect(() => extractDocxBytes(Uint8Array.of(1, 2, 3))).toThrow(AskKnowledgeError)
    expect(() => extractDocxBytes(Uint8Array.of(1, 2, 3))).toThrow('读不了这份 Word 文件')
    const emptyZip = zipSync({ '[Content_Types].xml': strToU8('<Types/>') })
    expect(() => extractDocxBytes(emptyZip)).toThrow('这份 Word 没有可提取的文字')
  })

  it('writes markdown for ingest and leaves other paths unchanged', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ask-knowledge-docx-ingest-'))
    const pdf = join(dir, 'a.pdf')
    await writeFile(pdf, 'x')
    expect(await writeDocxMarkdownForIngest({ path: pdf, dir, filename: 'a.pdf' })).toBe(pdf)
    const xml = `<?xml version="1.0"?><w:document xmlns:w="${WORD_NS}"><w:body><w:p><w:r><w:t>报销流程</w:t></w:r></w:p></w:body></w:document>`
    const docxPath = join(dir, '制度.docx')
    await writeFile(docxPath, docxBytes(xml))
    const md = await writeDocxMarkdownForIngest({ path: docxPath, dir, filename: '制度.docx' })
    expect(md).toBe(join(dir, '制度.md'))
    expect(await readFile(md, 'utf8')).toBe('报销流程\n')
    await writeFile(join(dir, '空.docx'), docxBytes(
      `<?xml version="1.0"?><w:document xmlns:w="${WORD_NS}"><w:body></w:body></w:document>`,
    ))
    await expect(writeDocxMarkdownForIngest({
      path: join(dir, '空.docx'),
      dir,
      filename: '空.docx',
    })).rejects.toMatchObject({ message: '这份 Word 没有可提取的文字' })
    const onlyExt = join(dir, 'only.docx')
    await writeFile(onlyExt, docxBytes(xml))
    expect(await writeDocxMarkdownForIngest({ path: onlyExt, dir, filename: '.docx' }))
      .toBe(join(dir, 'document.md'))
  })
})
