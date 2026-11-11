/**
 * Browser registration for the persistent-questions UI: mounts the package's
 * generated Remote contribution and registers the Session-header question
 * card, the Session-row leading mark, and the raw-result-driven question tool
 * card, all reading the one shared Remote-backed source over the mounted
 * `sessionDecisions` namespace. Internal module; the public `/client` entry
 * re-exports only `inject` and `apply`.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { SessionDecisionsRemote } from './questions-source.ts'
import { createQuestionSource } from './questions-source.ts'
import { QuestionCard } from './QuestionCard.tsx'
import { QuestionComposerCard } from './QuestionComposerCard.tsx'
import { SessionQuestionMark } from './SessionQuestionMark.tsx'
import { QuestionToolCard } from './QuestionToolCard.tsx'
import { en, NS, zh, type QuestionLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Persistent-questions card, mark, and tool-card copy. */
    sessionDecisions: QuestionLocaleKey
  }
}

/** Services the browser registration consumes; the mounted namespace arrives in a child fiber. */
export const inject = ['remote', 'slots', 'locale'] as const

/**
 * Register the persistent-questions UI slots into the client Context.
 * @param ctx - browser client context.
 * @param remote - the mounted `sessionDecisions` namespace, or `undefined`
 * when the composition mounts the UI without the feature Remote; every seat
 * then degrades to its truthful unavailable state.
 * @returns cleanup disposer.
 */
export function registerUi(ctx: ClientContext, remote?: SessionDecisionsRemote): () => void {
  // Assigned, not cast: the generated namespace must satisfy the internal port
  // or compilation fails.
  const mounted: SessionDecisionsRemote | undefined = remote ?? ctx.remote.sessionDecisions
  const source = createQuestionSource(mounted)
  const disposeDictionaries = ctx.locale.register(NS, { zh, en })
  // Everything allocated so far, in allocation order. A failure below rolls
  // this list back (latest first) so a retry starts clean instead of leaking
  // the poll interval or the locale dictionaries.
  const allocated: (() => void)[] = [() => { source.dispose() }, disposeDictionaries]
  try {
    const header = ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'session-questions',
        order: -6,
        locale: NS,
        inject: sessionId => ({ sessionId, source, hooks: source.hooks }),
      }, QuestionCard))
    allocated.push(header)
    const composer = ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'session-question-answer',
        order: -20,
        locale: NS,
        inject: sessionId => ({ sessionId, source, hooks: source.hooks }),
      }, QuestionComposerCard))
    allocated.push(composer)
    const mark = ctx.slots.inject('sidebar.session.row.leading', () =>
      ctx.slots.register({
        name: 'sidebar.session.row.leading',
        id: 'session-questions-mark',
        order: 15,
        locale: NS,
        inject: () => ({ source, hooks: source.hooks }),
      }, SessionQuestionMark))
    allocated.push(mark)
    const toolviews = ctx.slots.inject('tool.call.toolview', function* () {
      // Both question tools persist the same `{ decisionId, revision }` pointer;
      // each keyed entry presents the actual Remote-backed record state.
      yield ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'request_persistent_question',
        locale: NS,
        inject: () => ({ source, hooks: source.hooks }),
      }, QuestionToolCard)
      yield ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'read_persistent_question',
        locale: NS,
        inject: () => ({ source, hooks: source.hooks }),
      }, QuestionToolCard)
    })
    allocated.push(toolviews)
    return () => {
      toolviews()
      mark()
      composer()
      header()
      disposeDictionaries()
      source.dispose()
    }
  } catch (error) {
    for (const dispose of allocated.slice().reverse()) {
      try {
        dispose()
      } catch (_rollbackError) {
        // Best-effort rollback: keep releasing the remaining allocations and
        // surface the registration error, not a secondary disposal failure.
      }
    }
    throw error
  }
}

/**
 * Mount the persistent-questions UI and return the cleanup disposer.
 *
 * With the generated Remote contribution, the namespace is mounted first and
 * the registration runs in a child fiber waiting on the published
 * `remote.sessionDecisions` service; the contributions leave together.
 * Without one, the registration reads whatever `sessionDecisions` namespace
 * the composition already mounted.
 * @param ctx - browser client context.
 * @param contribution - generated Remote contribution of this package.
 * @returns cleanup disposer.
 */
export async function mountQuestionsUi(
  ctx: ClientContext,
  contribution?: TypertRemoteContribution,
): Promise<() => Promise<void>> {
  if (contribution && 'package' in contribution && 'descriptors' in contribution) {
    // Read through `ctx.get`, the honest face for a service this entry needs
    // but the caller's composition may not have mounted; fail loud with the
    // mount-specific message instead of an undefined dereference.
    const remote = ctx.get('remote')
    if (remote === undefined) throw new Error('session-decisions client requires the remote service to mount its namespace')
    const disposeRemote = await remote.$mount(contribution)
    // The generated namespace is a service published by $mount, so consume it in a child fiber.
    const ui = ctx.inject(['remote', 'remote.sessionDecisions', 'slots', 'locale'], (child) => {
      const mounted: SessionDecisionsRemote | undefined = child.remote.sessionDecisions
      const dispose = registerUi(child, mounted)
      return () => { dispose() }
    })
    try {
      await ui.await()
    } catch (error) {
      await ui.dispose()
      await disposeRemote()
      throw error
    }
    return async () => {
      await ui.dispose()
      await disposeRemote()
    }
  }
  const dispose = registerUi(ctx)
  return () => {
    dispose()
    return Promise.resolve()
  }
}
