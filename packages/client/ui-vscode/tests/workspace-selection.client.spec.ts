/** Selected VS Code roots use the existing Workspace and Session services. */

import { describe, expect, it, vi } from 'vitest'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  WorkspaceSelection,
  type WorkspaceSelectionSessions,
  type WorkspaceSelectionWorkspaces,
} from '../src/client/workspace-selection.ts'

describe('WorkspaceSelection', () => {
  it('registers, connects, and opens the selected root in order', async () => {
    const calls: string[] = []
    const create = vi.fn(async ({ path }: { path: string }) => {
      calls.push(`create:${path}`)
      return { workspaceId: 'workspace-1' as never }
    })
    const connectWorkspace = vi.fn(async (workspaceId: never) => {
      calls.push(`connect:${String(workspaceId)}`)
      return 'session-1' as never
    })
    const open = vi.fn((sessionId: never) => { calls.push(`open:${String(sessionId)}`) })
    const selection = new WorkspaceSelection({ create, connectWorkspace }, { open })

    await selection.select('/workspace/project')
    expect(calls).toEqual([
      'create:/workspace/project',
      'connect:workspace-1',
      'open:session-1',
    ])
  })

  it('serializes rapid changes and continues after a failed selection', async () => {
    const first = Promise.withResolvers<{ workspaceId: WorkspaceId }>()
    let createCall = 0
    const create = vi.fn((_: { path: string }): Promise<{ workspaceId: WorkspaceId }> => {
      createCall += 1
      if (createCall === 1) return first.promise
      if (createCall === 2) return Promise.reject(new Error('bad root'))
      return Promise.resolve({ workspaceId: 'workspace-3' as WorkspaceId })
    })
    const connectWorkspace = vi.fn(async (_: WorkspaceId): Promise<SessionId> => 'session-3' as SessionId)
    const open = vi.fn((_: SessionId): void => {})
    const workspaces: WorkspaceSelectionWorkspaces = { create, connectWorkspace }
    const sessions: WorkspaceSelectionSessions = { open }
    const selection = new WorkspaceSelection(workspaces, sessions)

    const one = selection.select('/one')
    const two = selection.select('/two')
    const three = selection.select('/three')
    await Promise.resolve()
    expect(create).toHaveBeenCalledTimes(1)
    first.resolve({ workspaceId: 'workspace-1' as WorkspaceId })
    await one
    await expect(two).rejects.toThrow('bad root')
    await three
    expect(create.mock.calls.map(call => call[0])).toEqual([
      { path: '/one' }, { path: '/two' }, { path: '/three' },
    ])
    expect(open).toHaveBeenCalledTimes(2)
  })
})
