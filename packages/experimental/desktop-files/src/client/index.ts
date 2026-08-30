/**
 * Browser half of the desktop file tree: occupies `sidebar.files` after
 * the official sidebar declares the hole.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { FileTree } from './FileTree.tsx'
import type { FileTreeInjected } from './FileTree.tsx'
import { en, zh, type FilesKey } from './locales.ts'

export type { FileTreeInjected, FileTreeProps } from './FileTree.tsx'
export type { FilesKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop file-tree copy. */
    'desktop-files': FilesKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'desktop-files'

/** Services required by the file-tree occupant. */
export const inject = ['slots', 'remote', 'remote.session', 'locale']

/**
 * Register the file tree into `sidebar.files` once the official shell
 * has declared that hole.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'desktop-files: dictionaries')
  const injected = (): FileTreeInjected => ({
    listEntries: (sessionId, path, signal) => ctx.remote.session.listEntries({
      sessionId,
      ...path === undefined ? {} : { path },
    }, signal),
    openPath: async (path) => {
      const result = await ctx.remote.session.openWorkspacePath({ path })
      if (!result.ok) throw new Error(`path open failed: ${result.error.message}`)
    },
  })
  ctx.slots.inject('sidebar.files', () => ctx.slots.register({
    name: 'sidebar.files',
    locale: NS,
    inject: injected,
  }, FileTree))
}
