/**
 * Service Definition for the `ctx.workspaceEntries` capability seam: one-level
 * listing of files and directories under a Host-owned project root. The
 * Consumer (`session.listEntries`) derives that root from a session's `cwd`;
 * Providers implement the filesystem fence and row kinds.
 * @module @deepseek-ai/dsh-host-workspace-entries
 */

import { Context, Service } from '@deepseek-ai/cordis'

/** Kind of one listed row. Directory-target symlinks are `directory`. */
export type WorkspaceEntryKind = 'file' | 'directory' | 'broken-symlink'

/** One child of a listed directory. Every `path` is an absolute Host path. */
export interface WorkspaceEntry {
  /** Base name shown in a tree row. */
  name: string
  /** Absolute host path — clients never join path segments themselves. */
  path: string
  /** Target kind after following a symlink; dangling links are `broken-symlink`. */
  kind: WorkspaceEntryKind
  /** Hidden by the POSIX dot-prefix convention; the client owns whether to show it. */
  hidden: boolean
  /** True when the directory entry itself is a symlink. */
  symlink: boolean
}

/** One directory level as a workspace-entries backend reports it. */
export interface WorkspaceEntriesListing {
  /** Absolute path of the listed directory. */
  path: string
  /** Absolute project root the listing was fenced to. */
  root: string
  /** Direct children, name-sorted; junk names are omitted by the Provider. */
  entries: WorkspaceEntry[]
  /**
   * True when the backend cut `entries` at its complete-result bound: the
   * level has more children than reported, and the missing rows are the
   * name-sorted tail (hidden rows count toward the bound).
   */
  truncated: boolean
}

/** Arguments of {@link WorkspaceEntries.list}. The Consumer supplies `root`. */
export interface WorkspaceEntriesListRequest {
  /** Absolute project root the listing must stay inside. */
  root: string
  /** Absolute directory to list; absent lists `root`. */
  path?: string
}

/** Closed failure vocabulary of the listing primitive (mirrored onto the wire by consumers). */
export type WorkspaceEntriesErrorCode = 'entries-unreadable' | 'entries-outside-root'

/** Typed failure thrown by listing so consumers can map business codes without string matching. */
export class WorkspaceEntriesError extends Error {
  /**
   * @param code - closed business code of the failure.
   * @param path - the absolute path the failure is about.
   * @param message - operator-facing description.
   * @param root - the listing root; required for `entries-outside-root`.
   */
  constructor(
    readonly code: WorkspaceEntriesErrorCode,
    readonly path: string,
    message: string,
    readonly root?: string,
  ) {
    super(message)
    this.name = 'WorkspaceEntriesError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workspaceEntries: WorkspaceEntries
  }
}

/**
 * Abstract one-level workspace listing service. Subclass, implement `list`,
 * and load the subclass as a plugin — it registers as `ctx.workspaceEntries`
 * (one implementation per context; loading a second throws, cordis' standard
 * duplicate-service behavior).
 */
export abstract class WorkspaceEntries extends Service {
  constructor(ctx: Context) {
    super(ctx, 'workspaceEntries')
  }

  /**
   * List one directory level inside `request.root`.
   * @param request - Host-derived root and optional fully-qualified list path.
   * @param signal - caller/connection lifetime; abort stops the scan.
   * @returns the level's listing; backends bound the complete result, and a
   * cut level reports `truncated`.
   * @throws {WorkspaceEntriesError} `entries-unreadable` when the target is
   * not fully qualified or cannot be listed; `entries-outside-root` when the
   * target (after realpath) leaves `root`.
   */
  abstract list(
    request: WorkspaceEntriesListRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceEntriesListing>
}

export default WorkspaceEntries
