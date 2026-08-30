/** Contract behavior the seam itself owns: registration identity and typed failures. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WorkspaceEntries, WorkspaceEntriesError } from '../src/index.ts'
import type { WorkspaceEntriesListing, WorkspaceEntriesListRequest } from '../src/index.ts'

/** Minimal concrete backend: a subclass owes the abstract class `list`. */
class StubEntries extends WorkspaceEntries {
  override list(
    request: WorkspaceEntriesListRequest,
    _signal?: AbortSignal,
  ): Promise<WorkspaceEntriesListing> {
    return Promise.resolve({
      path: request.path ?? request.root,
      root: request.root,
      entries: [],
      truncated: false,
    })
  }
}

describe('WorkspaceEntries seam', () => {
  it('registers a subclass as ctx.workspaceEntries and leaves with its fiber', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(StubEntries)
    await fiber.await()
    expect(ctx.get('workspaceEntries')).toBeInstanceOf(StubEntries)
    await expect(ctx.get('workspaceEntries')!.list({ root: '/proj' })).resolves.toMatchObject({
      path: '/proj',
      root: '/proj',
      entries: [],
    })
    await fiber.dispose()
    expect(ctx.get('workspaceEntries')).toBeUndefined()
  })

  it('carries the business code, subject path, and optional root on WorkspaceEntriesError', () => {
    const failure = new WorkspaceEntriesError(
      'entries-outside-root',
      '/etc',
      '/etc is outside /proj',
      '/proj',
    )
    expect(failure.name).toBe('WorkspaceEntriesError')
    expect(failure.code).toBe('entries-outside-root')
    expect(failure.path).toBe('/etc')
    expect(failure.root).toBe('/proj')
    expect(failure.message).toContain('outside')
    expect(failure).toBeInstanceOf(Error)
  })
})
