/**
 * octopus_DSH desktop file-tree Provider: `ctx.workspaceEntries` over the
 * host filesystem, fenced to the Consumer-supplied session cwd.
 * @module @deepseek-ai/dsh-experimental-desktop-files
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { WorkspaceEntries } from '@deepseek-ai/dsh-host-workspace-entries'
import type { WorkspaceEntriesListing, WorkspaceEntriesListRequest } from '@deepseek-ai/dsh-host-workspace-entries'
import { listEntries, type ListEntriesConfig } from './list-entries.ts'

/** Validated plugin configuration. */
export interface Config {
  /** Complete-result bound of one listing level; see {@link DesktopWorkspaceEntries.Config}. */
  maxEntries: number
}

/** The `ctx.workspaceEntries` desktop implementation. */
export default class DesktopWorkspaceEntries extends WorkspaceEntries {
  /**
   * `maxEntries` bounds the complete listing level a single `list` call may
   * materialize: at most this many child rows (hidden rows included), with
   * `truncated` flagging a cut level. Default 1000.
   */
  static Config: z<Config> = z.object({
    maxEntries: z.natural().min(1).default(1000),
  })

  /**
   * @param ctx - Host context that registers this service.
   * @param config - validated listing bound.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
  }

  /**
   * List one directory level inside `request.root`.
   * @param request - Host-derived root and optional fully-qualified list path.
   * @param signal - caller/connection lifetime; abort stops the scan.
   * @returns the level's listing.
   */
  override list(
    request: WorkspaceEntriesListRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceEntriesListing> {
    return listEntries(request, signal, this.config satisfies ListEntriesConfig)
  }
}
