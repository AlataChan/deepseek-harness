/** Frame and classify session-only documents. */

import { describe, expect, it } from 'vitest'
import {
  SESSION_DOCUMENT_ACCEPT,
  SESSION_DOCUMENT_MAX_CHARS,
  appendSessionDocument,
  frameSessionDocument,
  isSessionDocumentConvertExtension,
  isSessionDocumentSpreadsheet,
  isSessionDocumentPlainExtension,
  sessionDocumentExtension,
} from '../src/client/session-document.ts'

describe('session-document framing', () => {
  it('frames a basename and appends to a draft', () => {
    expect(sessionDocumentExtension('a/b/制度.PDF')).toBe('.pdf')
    expect(sessionDocumentExtension('note')).toBe('')
    expect(isSessionDocumentPlainExtension('.md')).toBe(true)
    expect(isSessionDocumentConvertExtension('.pdf')).toBe(true)
    expect(isSessionDocumentSpreadsheet('.xlsx')).toBe(true)
    expect(SESSION_DOCUMENT_ACCEPT).toContain('.pdf')
    const framed = frameSessionDocument('制度.pdf', '报销流程')
    expect(framed.truncated).toBe(false)
    expect(framed.text).toBe(
      '<session-document filename="制度.pdf">\n报销流程\n</session-document>',
    )
    expect(appendSessionDocument('', framed.text)).toBe(framed.text)
    expect(appendSessionDocument('先看这个  ', framed.text)).toBe(`先看这个\n\n${framed.text}`)
  })

  it('escapes the filename attribute and clips a long body', () => {
    const framed = frameSessionDocument('a"b&c<.md', '字'.repeat(SESSION_DOCUMENT_MAX_CHARS + 3))
    expect(framed.truncated).toBe(true)
    expect(framed.text).toContain('filename="a&quot;b&amp;c&lt;.md"')
    expect(framed.text).toContain('…（仅本会话，正文已截断）')
    expect([...framed.text].length).toBeGreaterThan(SESSION_DOCUMENT_MAX_CHARS)
  })
})
