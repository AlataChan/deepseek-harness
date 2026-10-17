/** Client extract-file uploads chunks and maps remote failures. */

import { describe, expect, it, vi } from 'vitest'
import { readFileBytes } from '../src/client/bytes.ts'
import { extractSessionDocumentFile } from '../src/client/extract-file.ts'
import { MAX_INGEST_CHUNK_BYTES, streamFileIngestChunks } from '../src/client/ingest-file.ts'

describe('extractSessionDocumentFile', () => {
  it('uploads chunks via File.slice without whole-file arrayBuffer and returns the finish payload', async () => {
    const remotes = {
      beginExtract: vi.fn(async () => ({ ok: true as const, value: 'h1' })),
      appendExtractChunk: vi.fn(async () => ({ ok: true as const, value: undefined })),
      finishExtract: vi.fn(async () => ({
        ok: true as const,
        value: { filename: '制度.pdf', text: '正文', truncated: false },
      })),
    }
    const payload = new Uint8Array(MAX_INGEST_CHUNK_BYTES + 12)
    payload.fill(65)
    const file = new File([payload], '制度.pdf', { type: 'application/pdf' })
    const wholeArrayBufferSpy = vi.spyOn(file, 'arrayBuffer')
    const sliceSpy = vi.spyOn(file, 'slice')
    await expect(extractSessionDocumentFile(remotes, file)).resolves.toEqual({
      ok: true,
      filename: '制度.pdf',
      text: '正文',
      truncated: false,
    })
    expect(wholeArrayBufferSpy).not.toHaveBeenCalled()
    expect(sliceSpy).toHaveBeenCalledTimes(2)
    expect(remotes.beginExtract).toHaveBeenCalledWith({ filename: '制度.pdf' })
    expect(remotes.appendExtractChunk).toHaveBeenCalledTimes(2)
    expect(remotes.finishExtract).toHaveBeenCalledWith({ handle: 'h1' })
  })

  it('yields one empty chunk for an empty file and aborts extract if File.slice fails mid-stream', async () => {
    const emptyChunks: string[] = []
    for await (const chunk of streamFileIngestChunks(new File([], 'empty.md'))) {
      emptyChunks.push(chunk)
    }
    expect(emptyChunks).toEqual([''])
    expect(await readFileBytes(new File([Uint8Array.of(9, 8)], 'b.bin'))).toEqual(Uint8Array.of(9, 8))

    const abortExtract = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const brokenFile = new File(['hello'], 'broken.md')
    vi.spyOn(brokenFile, 'slice').mockImplementation(() => {
      throw new Error('disk read failure')
    })
    await expect(extractSessionDocumentFile({
      beginExtract: async () => ({ ok: true, value: 'h-broken' }),
      appendExtractChunk: async () => ({ ok: true, value: undefined }),
      finishExtract: async () => ({ ok: true, value: { filename: 'broken.md', text: '', truncated: false } }),
      abortExtract,
    }, brokenFile)).rejects.toThrow('disk read failure')
    expect(abortExtract).toHaveBeenCalledWith({ handle: 'h-broken' })
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
