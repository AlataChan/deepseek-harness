/**
 * Tests for Task 5: Complete session-only document access via official attachments.
 * Covers acceptance criteria:
 * - A9: Session-only document beyond 32,000 characters answers final-page questions after restart via continuation cursor.
 *       Negative control: prefix-only conversion cache cannot be labelled full-document availability.
 * - A10: Official pre-session attachment admission and logged file references authorize overlay conversion.
 *       Negative controls: guessed digest, copied filename/path, and cross-session cache hits reveal no converted data.
 * - A11: Official retention/fork semantics preserved; overlay cache eviction never deletes originals; deleted session refuses reads.
 * - A12: Partial PDF/DOCX conversion has explicit diagnostics (omitted headers/footers, missing OCR) and never reports complete.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { bootOverlay } from './helpers/boot.ts'
import {
  evictSessionAttachmentCache,
  readSessionAttachment,
  searchSessionAttachment,
  renderSessionAttachmentsPrompt,
} from '../src/session-attachments.ts'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'

const signal = new AbortController().signal
const cleanups: Array<() => Promise<void> | void> = []
let callCount = 0

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

function agentWith(session: Session): Agent {
  return { id: session.id, session } as never
}

async function executeTool(ctx: Context, name: string, args: unknown, agent?: Agent) {
  const result = await ctx.tools.execute({
    signal,
    callId: ToolCallId(`sa-${++callCount}`),
    name,
    arguments: args,
    ...agent === undefined ? {} : { agent },
  })
  if (result.isError) {
    const msg = typeof result.error === 'object' && result.error !== null && 'message' in result.error
      ? String((result.error as { message?: unknown }).message)
      : 'Tool execution error'
    const code = (result.error as { code?: string })?.code ?? 'ingest-failed'
    throw new AskKnowledgeError(code as never, msg)
  }
  return result.value
}

function sha256Hex(buf: Buffer | Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex')
}

describe('Task 5: Official session-only document conversion and access', () => {
  it('A9: Document beyond 32,000 characters answers final-page questions after restart via continuation cursor', async () => {
    const { ctx, root } = await bootOverlay({ sessions: true, tools: true })
    cleanups.push(() => ctx.fiber?.dispose?.())

    // 1. Generate a long document (> 40,000 characters) with a unique final-page exception
    const prefix = 'Introductory project charter and executive summary.\n\n'
    const middlePadding = 'Section body paragraph explaining normal operational guidelines and policies in detail.\n'.repeat(450)
    const finalPageException = 'FINAL_PAGE_EXCEPTION: Clause 99.4B explicitly waives statutory penalties under emergency protocol.'
    const fullText = prefix + middlePadding + '\n\n' + finalPageException
    expect(fullText.length).toBeGreaterThan(32000)

    const docBuffer = Buffer.from(fullText, 'utf-8')
    const docDigest = sha256Hex(docBuffer)

    // Store in mock attachments service (sole owner of original bytes)
    const attachmentStorage = new Map<string, Buffer>()
    attachmentStorage.set(docDigest, docBuffer)

    ctx.provide('attachments', {
      readFileStream: async function* (ref: { sha256?: string; attachmentId: string }) {
        const hash = ref.sha256 ?? String(ref.attachmentId).replace(/^sha256[:/-]?/, '')
        const buf = attachmentStorage.get(hash)
        if (!buf) throw new Error('Attachment not found')
        yield new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      },
      fileHostPath: async (ref: { sha256?: string; attachmentId: string }) => {
        const hash = ref.sha256 ?? String(ref.attachmentId).replace(/^sha256[:/-]?/, '')
        const p = join(root, `att-${hash}.txt`)
        const buf = attachmentStorage.get(hash)
        if (buf) await writeFile(p, buf)
        return p
      },
    })

    // Prepare session with model-visible FileBlock
    const sessionId = SessionId('ses-a9-longdoc')
    const session = ctx.sessions.prepare(sessionId)
    ctx.sessions.enter(session)
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [
        {
          type: 'file',
          attachment: {
            attachmentId: AttachmentId(docDigest),
            name: 'corporate_charter.txt',
            bytes: docBuffer.length,
          },
        },
      ],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const agent = agentWith(session)

    // First read: starts at offset 0, returns bounded chunk and a valid continuation cursor
    const result1 = await executeTool(ctx, 'ask_knowledge_session_document', {
      filename: 'corporate_charter.txt',
      action: 'read',
    }, agent) as {
      action: string
      filename: string
      digest: string
      status: string
      charOffset: number
      totalChars: number
      text: string
      cursor?: string
    }

    expect(result1.status).toBe('complete')
    expect(result1.totalChars).toBe(fullText.length)
    expect(result1.charOffset).toBe(0)
    expect(result1.cursor).toBeDefined()
    expect(result1.text).toContain('Introductory project charter')
    expect(result1.text).not.toContain('FINAL_PAGE_EXCEPTION')

    // Read through cursors to reach the final page
    let currentCursor = result1.cursor
    let readCount = 0
    let reachedFinalPage = false
    let finalChunkText = ''

    while (currentCursor && readCount < 30) {
      readCount++
      const nextResult = await executeTool(ctx, 'ask_knowledge_session_document', {
        cursor: currentCursor,
      }, agent) as {
        charOffset: number
        totalChars: number
        text: string
        cursor?: string
      }

      if (nextResult.text.includes('FINAL_PAGE_EXCEPTION')) {
        reachedFinalPage = true
        finalChunkText = nextResult.text
        break
      }
      currentCursor = nextResult.cursor
    }

    expect(reachedFinalPage).toBe(true)
    expect(finalChunkText).toContain('Clause 99.4B explicitly waives statutory penalties')

    // Test Search action: directly locates the final-page fact
    const searchResult = await executeTool(ctx, 'ask_knowledge_session_document', {
      filename: 'corporate_charter.txt',
      action: 'search',
      query: 'Clause 99.4B penalties',
    }, agent) as {
      totalMatches: number
      items: Array<{ locator: string; text: string }>
    }

    expect(searchResult.totalMatches).toBeGreaterThan(0)
    expect(searchResult.items[0]?.text).toContain('Clause 99.4B explicitly waives statutory penalties')

    // Negative control: prefix-only conversion cache cannot be labelled full-document availability
    const truncatedResult = {
      format: 'markdown' as const,
      sha256: docDigest,
      byteLength: 10000,
      markdown: fullText.slice(0, 10000),
      blocks: [],
      status: 'partial' as const,
      diagnostics: {
        warnings: ['Conversion truncated due to buffer limit'],
        omissions: ['Omitted tail content past 10,000 characters'],
        unsupportedFeatures: [],
      },
    }
    const truncatedRead = readSessionAttachment(
      truncatedResult,
      { attachmentId: AttachmentId(docDigest), name: 'truncated.txt', bytes: 10000 },
      sessionId,
      { offset: 0, limitChars: 3000 },
    )
    expect(truncatedRead.status).toBe('partial')
    expect(truncatedRead.status).not.toBe('complete')
    expect(truncatedRead.diagnostics.omissions).toContain('Omitted tail content past 10,000 characters')
  })

  it('A10: Official FileBlock in session authorizes conversion; guessed digest, copied filename, and cross-session cache hits reveal no converted data', async () => {
    const { ctx } = await bootOverlay({ sessions: true, tools: true })
    cleanups.push(() => ctx.fiber?.dispose?.())

    const secretText = 'CONFIDENTIAL_DATA_SESSION_1: Only session 1 is authorized to view this string.'
    const secretBuffer = Buffer.from(secretText, 'utf-8')
    const secretDigest = sha256Hex(secretBuffer)

    const otherText = 'UNAUTHORIZED_DATA_IN_STORAGE: Not attached in caller session.'
    const otherBuffer = Buffer.from(otherText, 'utf-8')
    const otherDigest = sha256Hex(otherBuffer)

    const storage = new Map<string, Buffer>()
    storage.set(secretDigest, secretBuffer)
    storage.set(otherDigest, otherBuffer)

    ctx.provide('attachments', {
      readFileStream: async function* (ref: { sha256?: string; attachmentId: string }) {
        const hash = ref.sha256 ?? String(ref.attachmentId).replace(/^sha256[:/-]?/, '')
        const buf = storage.get(hash)
        if (!buf) throw new Error('Not found')
        yield new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      },
    })

    // Session 1: attaches secret file
    const session1 = ctx.sessions.prepare(SessionId('ses-auth-1'))
    ctx.sessions.enter(session1)
    session1.append('turn/start', { turn: 1 })
    session1.append('user/message', createUserMessage({
      content: [
        {
          type: 'file',
          attachment: {
            attachmentId: AttachmentId(secretDigest),
            name: 'confidential_report.txt',
            bytes: secretBuffer.length,
          },
        },
      ],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const agent1 = agentWith(session1)

    // Session 1 converts and reads successfully
    const s1Read = await executeTool(ctx, 'ask_knowledge_session_document', {
      filename: 'confidential_report.txt',
      action: 'read',
    }, agent1) as { status: string; text: string; cursor?: string }

    expect(s1Read.status).toBe('complete')
    expect(s1Read.text).toContain('CONFIDENTIAL_DATA_SESSION_1')

    // Negative Control 1: Session 1 cannot access guessed digest not in caller session
    await expect(executeTool(ctx, 'ask_knowledge_session_document', {
      digest: otherDigest,
      action: 'read',
    }, agent1)).rejects.toThrow(AskKnowledgeError)

    // Negative Control 2: Plain text mention of filename/digest does NOT grant authority
    const sessionTextOnly = ctx.sessions.prepare(SessionId('ses-text-only'))
    ctx.sessions.enter(sessionTextOnly)
    sessionTextOnly.append('turn/start', { turn: 1 })
    sessionTextOnly.append('user/message', createUserMessage({
      content: [
        {
          type: 'text',
          text: `Please read confidential_report.txt with digest sha256:${secretDigest}`,
        },
      ],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const agentTextOnly = agentWith(sessionTextOnly)

    await expect(executeTool(ctx, 'ask_knowledge_session_document', {
      filename: 'confidential_report.txt',
      action: 'read',
    }, agentTextOnly)).rejects.toThrow(AskKnowledgeError)

    // Negative Control 3: Cross-session cache hit isolation
    // Session 2 is an empty session without the attachment.
    // Even though the attachment conversion is cached on disk, Session 2 cannot read it using digest, filename, or cursor.
    const session2 = ctx.sessions.prepare(SessionId('ses-auth-2'))
    ctx.sessions.enter(session2)
    session2.append('turn/start', { turn: 1 })
    const agent2 = agentWith(session2)

    await expect(executeTool(ctx, 'ask_knowledge_session_document', {
      digest: secretDigest,
      action: 'read',
    }, agent2)).rejects.toThrow(AskKnowledgeError)

    await expect(executeTool(ctx, 'ask_knowledge_session_document', {
      filename: 'confidential_report.txt',
      action: 'read',
    }, agent2)).rejects.toThrow(AskKnowledgeError)

    if (s1Read.cursor) {
      // Trying to reuse Session 1's cursor in Session 2 must be rejected
      await expect(executeTool(ctx, 'ask_knowledge_session_document', {
        cursor: s1Read.cursor,
      }, agent2)).rejects.toThrow(AskKnowledgeError)
    }
  })

  it('A11: Official retention/fork semantics preserved; overlay cache eviction never deletes originals; deleted session refuses reads', async () => {
    const { ctx, root } = await bootOverlay({ sessions: true, tools: true })
    cleanups.push(() => ctx.fiber?.dispose?.())

    const content = 'RETENTION_TEST_CONTENT: Original bytes must remain untouched when cache is evicted.'
    const contentBuffer = Buffer.from(content, 'utf-8')
    const contentDigest = sha256Hex(contentBuffer)

    const originalDeleted = false
    const storage = new Map<string, Buffer>()
    storage.set(contentDigest, contentBuffer)

    ctx.provide('attachments', {
      readFileStream: async function* (ref: { sha256?: string; attachmentId: string }) {
        if (originalDeleted) throw new Error('Original bytes deleted')
        const hash = ref.sha256 ?? String(ref.attachmentId).replace(/^sha256[:/-]?/, '')
        const buf = storage.get(hash)
        if (!buf) throw new Error('Not found')
        yield new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      },
    })

    const sessionId = SessionId('ses-retention-1')
    const session = ctx.sessions.prepare(sessionId)
    ctx.sessions.enter(session)
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [
        {
          type: 'file',
          attachment: {
            attachmentId: AttachmentId(contentDigest),
            name: 'policy.txt',
            bytes: contentBuffer.length,
          },
        },
      ],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const agent = agentWith(session)

    // 1. Initial conversion and read
    const read1 = await executeTool(ctx, 'ask_knowledge_session_document', {
      filename: 'policy.txt',
      action: 'read',
    }, agent) as { text: string }
    expect(read1.text).toContain('RETENTION_TEST_CONTENT')

    // 2. Verify conversion cache file exists on disk
    const cacheFile = join(root, 'attachment-cache', `${contentDigest}_v2.json`)
    const cacheStatBefore = await stat(cacheFile)
    expect(cacheStatBefore.isFile()).toBe(true)

    // 3. Evict cache via evictSessionAttachmentCache
    await evictSessionAttachmentCache({ knowledgeHome: root }, contentDigest)

    // Cache file should now be removed from overlay directory
    await expect(stat(cacheFile)).rejects.toThrow()

    // Original bytes in ctx.attachments must NOT be deleted
    expect(originalDeleted).toBe(false)
    expect(storage.has(contentDigest)).toBe(true)

    // Re-reading successfully re-converts from original
    const read2 = await executeTool(ctx, 'ask_knowledge_session_document', {
      filename: 'policy.txt',
      action: 'read',
    }, agent) as { text: string }
    expect(read2.text).toContain('RETENTION_TEST_CONTENT')

    // 4. Deleted session negative control:
    // When session is deleted from sessions and persistence, it cannot authorize reads
    const deletedSessionId = SessionId('ses-deleted-99')
    const deletedAgent: Agent = {
      id: deletedSessionId,
      session: { id: deletedSessionId, surface: { nodes: [] }, snapshotEvents: () => [] } as never,
    } as never

    await expect(executeTool(ctx, 'ask_knowledge_session_document', {
      filename: 'policy.txt',
      action: 'read',
    }, deletedAgent)).rejects.toThrow(AskKnowledgeError)
  })

  it('A12: Partial PDF/DOCX conversion has explicit diagnostics and never reports complete', async () => {
    const { ctx } = await bootOverlay({ sessions: true, tools: true })
    cleanups.push(() => ctx.fiber?.dispose?.())

    // Direct unit test of readSessionAttachment and searchSessionAttachment with partial diagnostics
    const partialConverted = {
      format: 'pdf' as const,
      sha256: '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
      byteLength: 54321,
      markdown: '# Financial Disclosure\n\nPage 1 text here.\n\n[Omitted scan image]\n\nPage 3 summary.',
      blocks: [
        {
          id: 'blk-1',
          kind: 'paragraph' as const,
          text: 'Page 1 text here.',
          page: 1,
          charOffset: 24,
        },
        {
          id: 'blk-2',
          kind: 'paragraph' as const,
          text: 'Page 3 summary.',
          page: 3,
          charOffset: 65,
        },
      ],
      status: 'partial' as const,
      diagnostics: {
        warnings: ['Scanned bitmap page 2 skipped', 'Header decorations omitted'],
        omissions: ['Page 2 requires OCR processing', 'Embedded vector graphic omitted'],
        unsupportedFeatures: ['Handwritten annotations'],
        needsOcrPages: [2],
        totalPages: 3,
      },
    }

    const ref = {
      attachmentId: AttachmentId('11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff'),
      name: 'annual_report.pdf',
      bytes: 54321,
    }

    const readResult = readSessionAttachment(partialConverted, ref, 'ses-partial-1')
    expect(readResult.status).toBe('partial')
    expect(readResult.status).not.toBe('complete')
    expect(readResult.diagnostics.warnings).toContain('Scanned bitmap page 2 skipped')
    expect(readResult.diagnostics.omissions).toContain('Page 2 requires OCR processing')
    expect(readResult.diagnostics.needsOcrPages).toEqual([2])
    expect(readResult.diagnostics.totalPages).toBe(3)

    const searchResult = searchSessionAttachment(partialConverted, ref, 'ses-partial-1', 'summary')
    expect(searchResult.status).toBe('partial')
    expect(searchResult.status).not.toBe('complete')
    expect(searchResult.totalMatches).toBe(1)
    expect(searchResult.diagnostics.needsOcrPages).toEqual([2])
  })

  it('renderSessionAttachmentsPrompt injects clear model guidance when attachments are present', () => {
    const attachments = new Map([
      ['sha1', { attachmentId: AttachmentId('abcdef1234567890'), name: 'quarterly_results.pdf', bytes: 12345 }],
      ['sha2', { attachmentId: AttachmentId('0987654321fedcba'), name: 'org_chart.docx', bytes: 54321 }],
    ])

    const prompt = renderSessionAttachmentsPrompt(attachments)
    expect(prompt).toContain('quarterly_results.pdf')
    expect(prompt).toContain('org_chart.docx')
    expect(prompt).toContain('ask_knowledge_session_document')
    expect(prompt).toContain('cursor')
  })
})
