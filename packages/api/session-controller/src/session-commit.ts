/**
 * Shared Session bind transaction: the blankness check and the compensation
 * every binding Remote runs when its seam refuses the bind.
 * @module @deepseek-ai/dsh-api-session-controller/session-commit
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace'

/** Workspace face a commit attaches to and detaches from. */
export interface SessionCommitWorkspace {
  detachSession(sessionId: SessionId): Promise<void>
}

/** Everything one failed bind must undo, in reverse order of acquisition. */
export interface SessionCommitCompensation {
  /** Seam-owned rollback of a completed bind; absent when the seam has none. */
  readonly rollback?: (() => Promise<void>) | undefined
  /** Whether this commit changed the Session's preset. */
  readonly changedPreset: boolean
  /** Preset the Session carried before this commit. */
  readonly previousPreset: string
  readonly agent: Agent
  /** Handle of a Session this commit created; absent for an existing Session. */
  readonly handle?: AgentHandle | undefined
  /** Workspace this commit attached; absent when it attached none. */
  readonly workspace?: SessionCommitWorkspace | undefined
  readonly sessionId: SessionId
  readonly created: boolean
  /** Whether the Session is still blank, so restoring its preset is safe. */
  readonly stillBlank?: (() => boolean) | undefined
  readonly ctx: Context
}

/** Where a commit that creates a Session puts it. */
export interface SessionCommitTarget {
  /** Workspace the new Session attaches to; absent when the request named none. */
  readonly workspace?: Workspace | undefined
  /** Project directory the created Session owns. */
  readonly cwd: string
  /** Identity minted for the created Session. */
  readonly sessionId: SessionId
}

/**
 * Resolve the workspace, project directory, and identity of a Session a commit
 * is about to create.
 * @param ctx - Host context holding the workspace registry.
 * @param workspaceId - workspace named by the request, or undefined.
 * @param defaultCwd - project directory used when the request names no workspace.
 * @returns the resolved commit target.
 * @throws RemoteError `workspace/not-found` when the named workspace is absent.
 */
export function resolveCommitTarget(
  ctx: Context,
  workspaceId: WorkspaceId | undefined,
  defaultCwd: string,
): SessionCommitTarget {
  const workspace = workspaceId === undefined ? undefined : ctx.workspaceRegistry.get(workspaceId)
  if (workspaceId !== undefined && workspace === undefined) {
    throw new RemoteError('workspace/not-found', `workspace "${workspaceId}" not found`, { workspaceId })
  }
  return {
    ...workspace === undefined ? {} : { workspace },
    cwd: workspace?.path ?? defaultCwd,
    sessionId: brandString<SessionId>(`session-${randomUUID()}`),
  }
}

/**
 * Whether a Session carries no turn of its own.
 * @param ctx - Host context holding the projection registry.
 * @param agent - live Agent whose Session is inspected.
 * @returns true while the Session has no started turn.
 */
export function isBlankSession(ctx: Context, agent: Agent): boolean {
  const meta = ctx.sessionProjections.stateOf(agent.session, 'sessionListMetadata')
  if (meta !== undefined) return meta.blank
  const boundary = ctx.sessionProjections.stateOf(agent.session, 'turnBoundary')
  if (boundary === undefined) return true
  return boundary.openTurnStartSeq === null && boundary.lastTurn === 0
}

/**
 * Undo a failed bind. Every step keeps the original business failure: a
 * compensation error is swallowed so the caller still reports why the bind
 * failed.
 * @param input - what the failed commit acquired.
 * @returns settlement after every acquired resource is released.
 */
export async function compensateSessionCommit(input: SessionCommitCompensation): Promise<void> {
  if (input.rollback !== undefined) {
    try {
      await input.rollback()
    } catch {
      // keep the original business error; continue compensation
    }
  }
  if (input.changedPreset && input.stillBlank?.() === true) {
    try {
      const presets = input.ctx.get('agentPresets')
      await presets?.select(input.agent, input.previousPreset)
    } catch {
      // keep the original business error
    }
  }
  if (input.workspace !== undefined) {
    try {
      await input.workspace.detachSession(input.sessionId)
    } catch {
      // keep the original business error
    }
  }
  if (input.created && input.handle !== undefined) {
    try {
      await input.handle.dispose()
    } catch {
      // keep the original business error; handle.dispose is best-effort
    }
  }
}
