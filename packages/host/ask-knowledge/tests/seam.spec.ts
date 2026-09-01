/** Contract behavior the seam itself owns: registration identity and typed failures. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  AskKnowledge, AskKnowledgeError, AskKnowledgeIngestHandle, AskKnowledgeLibraryId,
} from '../src/index.ts'
import type {
  AskKnowledgeAttachLease, AskKnowledgeBundle, AskKnowledgeExtractResult, AskKnowledgeIngestResult,
  AskKnowledgeLibrary, AskKnowledgeLookup, AskKnowledgeStatus,
} from '../src/index.ts'
import { askKnowledgeBindingProjectionDefinition } from '../src/session.ts'
import '../src/client.ts'

class StubAskKnowledge extends AskKnowledge {
  override listLibraries(_signal?: AbortSignal): Promise<AskKnowledgeLibrary[]> {
    return Promise.resolve([])
  }

  override createLibrary(
    request: { displayName: string },
    _signal?: AbortSignal,
  ): Promise<AskKnowledgeLibrary> {
    return Promise.resolve({
      id: AskKnowledgeLibraryId('lib-1'),
      displayName: request.displayName,
      createdAt: '2026-08-31T00:00:00.000Z',
      lastUsedAt: '2026-08-31T00:00:00.000Z',
      missing: false,
      deleting: false,
    })
  }

  override renameLibrary(
    request: { libraryId: AskKnowledgeLibraryId; displayName: string },
    _signal?: AbortSignal,
  ): Promise<AskKnowledgeLibrary> {
    return Promise.resolve({
      id: request.libraryId,
      displayName: request.displayName,
      createdAt: '2026-08-31T00:00:00.000Z',
      lastUsedAt: '2026-08-31T00:00:00.000Z',
      missing: false,
      deleting: false,
    })
  }

  override removeLibrary(_request: { libraryId: AskKnowledgeLibraryId }): Promise<void> {
    return Promise.resolve()
  }

  override attach(request: {
    libraryId: AskKnowledgeLibraryId
    sessionId: SessionId
  }): Promise<AskKnowledgeAttachLease> {
    void request.sessionId
    return Promise.resolve({
      binding: { libraryId: request.libraryId, displayName: '库' },
      rollback: () => Promise.resolve(),
    })
  }

  override detach(_request: { sessionId: SessionId }): Promise<void> {
    return Promise.resolve()
  }

  override beginIngest(): Promise<AskKnowledgeIngestHandle> {
    return Promise.resolve(AskKnowledgeIngestHandle('h1'))
  }

  override appendIngestChunk(): Promise<void> {
    return Promise.resolve()
  }

  override finishIngest(): Promise<AskKnowledgeIngestResult> {
    return Promise.resolve({ status: 'applied' })
  }

  override beginExtract(): Promise<AskKnowledgeIngestHandle> {
    return Promise.resolve(AskKnowledgeIngestHandle('h-extract'))
  }

  override appendExtractChunk(): Promise<void> {
    return Promise.resolve()
  }

  override finishExtract(): Promise<AskKnowledgeExtractResult> {
    return Promise.resolve({ filename: 'note.md', text: '正文', truncated: false })
  }

  override libraryStatus(request: {
    libraryId: AskKnowledgeLibraryId
  }): Promise<AskKnowledgeStatus> {
    return Promise.resolve({
      library: {
        id: request.libraryId,
        displayName: '库',
        createdAt: '2026-08-31T00:00:00.000Z',
        lastUsedAt: '2026-08-31T00:00:00.000Z',
        missing: false,
        deleting: false,
      },
      pendingAuditCount: 0,
    })
  }

  override retrieveBundle(): Promise<AskKnowledgeBundle> {
    return Promise.resolve({ items: [], warnings: [], tokenEstimate: 0 })
  }

  override lookup(): Promise<AskKnowledgeLookup> {
    return Promise.resolve({ term: '报销', warnings: [] })
  }

  override placeShortcut(): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true })
  }

  override revealLibrary(): Promise<void> {
    return Promise.resolve()
  }
}

describe('AskKnowledge seam', () => {
  it('registers a subclass as ctx.askKnowledge and leaves with its fiber', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(StubAskKnowledge)
    await fiber.await()
    expect(ctx.get('askKnowledge')).toBeInstanceOf(StubAskKnowledge)
    await expect(ctx.get('askKnowledge')!.listLibraries()).resolves.toEqual([])
    await fiber.dispose()
    expect(ctx.get('askKnowledge')).toBeUndefined()
  })

  it('carries the business code and optional rule id on AskKnowledgeError', () => {
    const failure = new AskKnowledgeError('file-too-large', 'too big', { ruleId: 'file-size', limit: 3 })
    expect(failure.name).toBe('AskKnowledgeError')
    expect(failure.code).toBe('file-too-large')
    expect(failure.details.ruleId).toBe('file-size')
    expect(failure.details.limit).toBe(3)
    expect(failure).toBeInstanceOf(Error)
    const bare = new AskKnowledgeError('ingest-failed', 'no details')
    expect(bare.details).toEqual({})
  })

  it('brands library and ingest-handle ids', () => {
    expect(AskKnowledgeLibraryId('lib-1')).toBe('lib-1')
    expect(AskKnowledgeIngestHandle('h1')).toBe('h1')
  })

  it('folds bound and unbound into the projection and ignores other events', () => {
    const bound = { libraryId: 'lib-1', displayName: '制度' }
    expect(askKnowledgeBindingProjectionDefinition.init()).toBeNull()
    const fold = askKnowledgeBindingProjectionDefinition.apply
    expect(fold(null, {
      type: 'ask-knowledge/bound',
      data: bound,
    } as never)).toEqual(bound)
    expect(fold(bound, {
      type: 'ask-knowledge/unbound',
      data: { libraryId: 'lib-1' },
    } as never)).toBeNull()
    expect(fold(bound, {
      type: 'session/title',
      data: { title: 'x' },
    } as never)).toEqual(bound)
    expect(askKnowledgeBindingProjectionDefinition.wire.view(bound)).toEqual(bound)
    expect(askKnowledgeBindingProjectionDefinition.key).toBe('askKnowledgeBinding')
    expect(askKnowledgeBindingProjectionDefinition.stateVersion).toBe(1)
  })
})
