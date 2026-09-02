// @vitest-environment jsdom
/** Frame and classify session-only documents. */

import { describe, expect, it, vi } from 'vitest'
import {
  SESSION_DOCUMENT_ACCEPT,
  SESSION_DOCUMENT_MAX_CHARS,
  appendSessionDocument,
  bindNativeFileChange,
  frameSessionDocument,
  isSessionDocumentConvertExtension,
  isSessionDocumentSpreadsheet,
  isSessionDocumentPlainExtension,
  readSessionDocumentText,
  sessionDocumentExtension,
} from '../src/client/session-document.ts'

describe('session-document framing', () => {
  it('frames a basename and appends to a draft', () => {
    expect(sessionDocumentExtension('a/b/制度.PDF')).toBe('.pdf')
    expect(sessionDocumentExtension('note')).toBe('')
    expect(isSessionDocumentPlainExtension('.md')).toBe(true)
    expect(isSessionDocumentConvertExtension('.pdf')).toBe(true)
    expect(isSessionDocumentConvertExtension('.docx')).toBe(true)
    expect(isSessionDocumentSpreadsheet('.xlsx')).toBe(true)
    expect(SESSION_DOCUMENT_ACCEPT).toContain('.pdf')
    expect(SESSION_DOCUMENT_ACCEPT).toContain('.docx')
    const framed = frameSessionDocument('制度.pdf', '报销流程')
    expect(framed.truncated).toBe(false)
    expect(framed.text).toBe(
      '<session-document filename="制度.pdf">\n报销流程\n</session-document>',
    )
    expect(appendSessionDocument('', framed.text)).toBe(framed.text)
    expect(appendSessionDocument('先看这个  ', framed.text)).toBe(`先看这个\n\n${framed.text}`)
  })

  it('reads File.text and falls back to FileReader', async () => {
    const ok = new File(['报销流程'], '制度.md', { type: 'text/markdown' })
    await expect(readSessionDocumentText(ok)).resolves.toBe('报销流程')
    const broken = new File(['回退正文'], '制度.md', { type: 'text/markdown' })
    Object.defineProperty(broken, 'text', {
      value: () => Promise.reject(new Error('webview')),
    })
    await expect(readSessionDocumentText(broken)).resolves.toBe('回退正文')
    const noText = new File(['无 text()'], '制度.md', { type: '' })
    Object.defineProperty(noText, 'text', { value: undefined })
    await expect(readSessionDocumentText(noText)).resolves.toBe('无 text()')
  })

  it('rejects when FileReader cannot read the file', async () => {
    const file = new File(['x'], 'a.md', { type: '' })
    Object.defineProperty(file, 'text', { value: undefined })
    const Original = FileReader
    class BoomReader extends Original {
      override readAsText(): void {
        queueMicrotask(() => {
          Object.defineProperty(this, 'error', { value: null })
          this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>)
        })
      }
    }
    vi.stubGlobal('FileReader', BoomReader)
    await expect(readSessionDocumentText(file)).rejects.toThrow('FileReader failed')
    class DiskReader extends Original {
      override readAsText(): void {
        queueMicrotask(() => {
          Object.defineProperty(this, 'error', { value: new Error('disk') })
          this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>)
        })
      }
    }
    vi.stubGlobal('FileReader', DiskReader)
    await expect(readSessionDocumentText(file)).rejects.toThrow('disk')
    vi.unstubAllGlobals()
  })

  it('treats a non-string FileReader result as empty text', async () => {
    const file = new File(['x'], 'a.md', { type: '' })
    Object.defineProperty(file, 'text', { value: undefined })
    const Original = FileReader
    class OddReader extends Original {
      override readAsText(): void {
        queueMicrotask(() => {
          Object.defineProperty(this, 'result', { value: 1 })
          this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>)
        })
      }
    }
    vi.stubGlobal('FileReader', OddReader)
    await expect(readSessionDocumentText(file)).resolves.toBe('')
    vi.unstubAllGlobals()
  })

  it('delivers native file-input change and ignores cancel', async () => {
    const input = document.createElement('input')
    input.type = 'file'
    const seen: File[][] = []
    const off = bindNativeFileChange(input, (files) => { seen.push([...files]) })
    expect(bindNativeFileChange(null, () => {})()).toBeUndefined()
    input.dispatchEvent(new Event('cancel'))
    input.dispatchEvent(new Event('change'))
    expect(seen).toEqual([])
    Object.defineProperty(input, 'files', { configurable: true, value: null })
    input.dispatchEvent(new Event('change'))
    expect(seen).toEqual([[]])
    await Promise.resolve()
    const file = new File(['x'], 'a.md', { type: '' })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input.dispatchEvent(new Event('change'))
    input.dispatchEvent(new Event('input'))
    expect(seen).toHaveLength(2)
    expect(seen[1]?.[0]).toBe(file)
    await Promise.resolve()
    Object.defineProperty(input, 'files', { configurable: true, value: [] })
    input.dispatchEvent(new Event('change'))
    expect(seen).toHaveLength(2)
    off()
  })

  it('escapes the filename attribute and clips a long body', () => {
    const framed = frameSessionDocument('a"b&c<.md', '字'.repeat(SESSION_DOCUMENT_MAX_CHARS + 3))
    expect(framed.truncated).toBe(true)
    expect(framed.text).toContain('filename="a&quot;b&amp;c&lt;.md"')
    expect(framed.text).toContain('…（仅本会话，正文已截断）')
    expect([...framed.text].length).toBeGreaterThan(SESSION_DOCUMENT_MAX_CHARS)
  })
})
