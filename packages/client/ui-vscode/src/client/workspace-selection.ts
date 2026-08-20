/** Selected-root orchestration over the existing Workspace and Session services. */

import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'

/** Minimal Workspace service operations used by selected-root handling. */
export interface WorkspaceSelectionWorkspaces {
  /** Register or idempotently resolve one absolute root. */
  create(input: { path: string }): Promise<{ workspaceId: WorkspaceId }>
  /** Resolve the Workspace's reusable or new blank Session. */
  connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>
}

/** Minimal Session navigation operation used by selected-root handling. */
export interface WorkspaceSelectionSessions {
  /** Select the connected Session. */
  open(sessionId: SessionId): void
}

/** Serial selected-root controller; one failed root does not poison later changes. */
export class WorkspaceSelection {
  private tail = Promise.resolve()

  /**
   * @param workspaces - existing Workspace registration and connection service.
   * @param sessions - existing Session navigation service.
   */
  constructor(
    private readonly workspaces: WorkspaceSelectionWorkspaces,
    private readonly sessions: WorkspaceSelectionSessions,
  ) {}

  /**
   * Register, connect, and open one extension-selected root in order.
   * @param workspaceRoot - selected absolute workspace path.
   * @returns completion after the Session becomes current.
   */
  select(workspaceRoot: string): Promise<void> {
    const operation = this.tail.then(async () => {
      const workspace = await this.workspaces.create({ path: workspaceRoot })
      const sessionId = await this.workspaces.connectWorkspace(workspace.workspaceId)
      this.sessions.open(sessionId)
    })
    this.tail = operation.catch(() => {})
    return operation
  }
}
