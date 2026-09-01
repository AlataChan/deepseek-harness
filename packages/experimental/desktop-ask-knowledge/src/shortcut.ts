/**
 * Optional workspace-folder symlink to a vault.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/shortcut
 */

import { mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { assertVaultDir, requireLibrary } from './catalog.ts'
import { canOpenNativePath, openNativePath } from '@deepseek-ai/dsh-native-command'

/**
 * Place `<workspace>/知识库/<safeName>` → vault.
 * @param ctx - Host context with workspaceRegistry.
 * @param knowledgeHome - app-data directory.
 * @param libraryId - catalog id.
 * @param workspaceId - workspace identity.
 * @returns whether the symlink was written.
 */
export async function placeLibraryShortcut(
  ctx: Context,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  workspaceId: WorkspaceId,
): Promise<{ ok: boolean; path?: string; reason?: string }> {
  const workspace = ctx.get('workspaceRegistry')?.get(workspaceId)
  if (workspace === undefined) return { ok: false, reason: 'workspace-missing' }
  const row = await requireLibrary(knowledgeHome, libraryId)
  const vault = await assertVaultDir(knowledgeHome, row)
  const dir = join(workspace.path, '知识库')
  const target = join(dir, safeName(row.displayName))
  try {
    await mkdir(dir, { recursive: true })
    await symlink(vault, target)
    return { ok: true, path: target }
  } catch (error: unknown) {
    return {
      ok: false,
      /* v8 ignore next -- fs.symlink throws Error */
      reason: error instanceof Error ? error.message : 'shortcut-failed',
    }
  }
}

/**
 * Reveal the vault in the host file manager.
 * @param knowledgeHome - app-data directory.
 * @param libraryId - catalog id.
 */
export async function revealLibraryVault(
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
): Promise<void> {
  const row = await requireLibrary(knowledgeHome, libraryId)
  const vault = await assertVaultDir(knowledgeHome, row)
  if (!canOpenNativePath()) {
    throw new AskKnowledgeError('not-ready', 'host cannot open a folder')
  }
  await openNativePath(vault, new AbortController().signal)
}

function safeName(displayName: string): string {
  const trimmed = displayName.trim().replace(/[\\/]/g, '-')
  return trimmed === '' ? 'library' : trimmed
}
