/** One Changes tab and one generated Remote namespace, with effect-owned disposal. */
import { createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-experimental-client-ui-forge/remote'
import { Button, IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { createPanelSource, type PanelSource } from './source.ts'
import { LocalReviewTab, type LocalReviewInjected } from './LocalReviewTab.tsx'
import { WorktreeNotice, type ActionNotice } from './WorktreeProgress.tsx'
import { en, NS, zh, type ForgePanelKey } from './locales.ts'

/** Required Client services. */
export const inject = ['remote', 'slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'sessions']
/** Stable identity of the single local review tab. */
export const TAB_ID = 'worktree-review'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'worktree-review': ForgePanelKey }
}

/**
 * Open the one Changes tab from the conversation header.
 * @param props - Session identity, navigation, and localized copy.
 * @returns the labeled entry action.
 */
function ChangesEntry({ sessionId, open, t }: PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'worktree-review'> & { open: (sessionId: SessionId) => void }) {
  return createElement(Button, { size: 'sm', icon: createElement(IconBranchOutlineRegular), onClick: () => { open(sessionId) } }, t('title'))
}

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'worktree-review: dictionaries')
  const t = ctx.locale.bind(NS)
  const stores = new Map<SessionId, PanelSource>()
  let notice: ActionNotice | null = null
  let sequence = 0
  const notices = new Set<() => void>()
  const publish = (value: ActionNotice | null): void => { notice = value; for (const listener of [...notices]) listener() }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: TAB_ID, locale: NS,
    inject: () => ({
      hooks: { notice: {
        getSnapshot: () => notice,
        subscribe(listener: () => void) { notices.add(listener); return () => { notices.delete(listener) } },
      } },
      dismiss: () => { publish(null) },
    }),
  }, WorktreeNotice))
  const settle = <T>(result: RemoteResult<T>): T => {
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const injected: LocalReviewInjected = {
    source(sessionId) {
      let store = stores.get(sessionId)
      if (store !== undefined) return store
      store = createPanelSource({
        open: signal => ctx.remote.forgePanel.follow(sessionId, signal),
        subscribeReset: listener => ctx.on('connection/reset', listener),
      })
      stores.set(sessionId, store)
      return store
    },
    async action(sessionId, action) {
      try {
        const result = action === 'requestWorktree'
          ? await ctx.remote.forgePanel.requestWorktree(sessionId, null)
          : await ctx.remote.forgePanel[action](sessionId)
        settle(result)
        publish({ sequence: ++sequence, success: true })
      } catch (error) {
        void error // The shell overlay reports the refused action; the panel retains its state.
        publish({ sequence: ++sequence, success: false })
      }
    },
    async readDiff(sessionId, scope, signal) { return settle(await ctx.remote.forgePanel.localDiff(sessionId, scope, signal)) },
  }
  ctx.effect(() => () => { for (const store of stores.values()) store.close(); stores.clear(); notices.clear() }, 'worktree-review: streams')
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: TAB_ID, kind: TAB_ID, title: () => t('title'), guide: [{ id: TAB_ID, order: 40, title: () => t('title'), description: () => t('description'), icon: IconBranchOutlineRegular }] }), 'worktree-review: tab type')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS, inject: () => injected }, LocalReviewTab))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: TAB_ID, locale: NS, inject: () => ({ open: (sessionId: SessionId) => { ctx.sidebarRight.openTabIn(sessionId, TAB_ID) } }) }, ChangesEntry))
}

/**
 * Mount the generated Remote then register the only Changes tab.
 * @param ctx - Client composition context.
 * @param contribution - generated local worktree Remote descriptors.
 * @returns disposer that releases UI effects before the Remote.
 */
export async function mountLocalReviewUi(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const remote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.forgePanel', 'slots', 'locale', 'sidebarRightTabs', 'sidebarRight'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await remote(); throw error }
  return async () => { await ui.dispose(); await remote() }
}
