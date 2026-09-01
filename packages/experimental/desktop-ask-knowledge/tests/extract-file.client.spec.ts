/** Client extract-file uploads chunks and maps remote failures. */

import { describe, expect, it, vi } from 'vitest'
import { extractSessionDocumentFile } from '../src/client/extract-file.ts'

describe('extractSessionDocumentFile', () => {
  it('uploads chunks and returns the finish payload', async () => {
    const remotes = {
      beginExtract: vi.fn(async () => ({ ok: true as const, value: 'h1' })),
      appendExtractChunk: vi.fn(async () => ({ ok: true as const, value: undefined })),
      finishExtract: vi.fn(async () => ({
        ok: true as const,
        value: { filename: '制度.pdf', text: '正文', truncated: false },
      })),
    }
    const file = new File([Uint8Array.of(1, 2, 3)], '制度.pdf', { type: 'application/pdf' })
    await expect(extractSessionDocumentFile(remotes, file)).resolves.toEqual({
      ok: true,
      filename: '制度.pdf',
      text: '正文',
      truncated: false,
    })
    expect(remotes.beginExtract).toHaveBeenCalledWith({ filename: '制度.pdf' })
    expect(remotes.appendExtractChunk).toHaveBeenCalled()
    expect(remotes.finishExtract).toHaveBeenCalledWith({ handle: 'h1' })
  })

  it('returns the first remote error', async () => {
    await expect(extractSessionDocumentFile({
      beginExtract: async () => ({ ok: false, error: { message: 'begin failed' } }),
      appendExtractChunk: async () => ({ ok: true, value: undefined }),
      finishExtract: async () => ({ ok: true, value: { filename: 'a.md', text: 't', truncated: false } }),
    }, new File(['hi'], 'a.md'))).resolves.toEqual({ ok: false, error: 'begin failed' })
    await expect(extractSessionDocumentFile({
      beginExtract: async () => ({ ok: true, value: 'h' }),
      appendExtractChunk: async () => ({ ok: false, error: { message: 'append failed' } }),
      finishExtract: async () => ({ ok: true, value: { filename: 'a.md', text: 't', truncated: false } }),
    }, new File(['hi'], 'a.md'))).resolves.toEqual({ ok: false, error: 'append failed' })
    await expect(extractSessionDocumentFile({
      beginExtract: async () => ({ ok: true, value: 'h' }),
      appendExtractChunk: async () => ({ ok: true, value: undefined }),
      finishExtract: async () => ({ ok: false, error: { message: 'finish failed' } }),
    }, new File(['hi'], 'a.md'))).resolves.toEqual({ ok: false, error: 'finish failed' })
  })
})
