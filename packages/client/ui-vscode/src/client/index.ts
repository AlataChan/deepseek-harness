/** VS Code Webview UI plugin: explicit editor context and selected-root projection. */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  EditorContextSnapshot,
} from '@deepseek-ai/dsh-client-connection-vscode/protocol'
import type { VsCodeIdePort } from '@deepseek-ai/dsh-client-connection-vscode/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { ContextButton, type ContextButtonInjected, type EditorCaptureKind } from './ContextButton.tsx'
import { EditorContextSource } from './context-source.ts'
import { en, zh, type VsCodeKey } from './locales.ts'
import { WorkspaceSelection } from './workspace-selection.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Explicit VS Code editor context and selected-root feedback. */
    'vscode': VsCodeKey
  }
}

/** Services required by the VS Code-only Client UI contribution. */
export const inject = [
  'slots', 'sessions', 'workspaces', 'conversation', 'inputTriggers', 'locale', 'vscodeIde',
]

const NS = 'vscode'

function contextLabel(snapshot: EditorContextSnapshot, diagnosticsLabel: string): string {
  const path = snapshot.workspacePath ?? snapshot.uri
  if (snapshot.kind === 'selection' && snapshot.range !== undefined) {
    const start = snapshot.range.startLine + 1
    const end = snapshot.range.endLine + 1
    return `${path}:${String(start)}${end === start ? '' : `-${String(end)}`}`
  }
  return snapshot.kind === 'diagnostics' ? `${path} · ${diagnosticsLabel}` : path
}

function notifyCurrent(ctx: ClientContext, text: string): void {
  const current = ctx.sessions.list.getSnapshot().current
  if (current === undefined) return
  const actx = ctx.sessions.scope(current)
  /* v8 ignore next -- the current id and its scope are read from the same synchronous session registry snapshot. */
  if (actx === undefined) return
  const conversation: IConversation | undefined = actx.get('conversation')
  conversation?.input.for(actx).notify('error', text)
}

/**
 * Mount explicit capture controls, reference serialization, and selected-root handling.
 * @param ctx - Client root context carrying the private typed VS Code IDE port.
 */
export function apply(ctx: ClientContext): void {
  const ide: VsCodeIdePort | undefined = ctx.get('vscodeIde')
  if (ide === undefined) throw new Error('ui-vscode: vscodeIde service is unavailable')
  const source = new EditorContextSource()
  const selection = new WorkspaceSelection(ctx.workspaces, ctx.sessions)
  const t = ctx.locale.bind(NS)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-vscode: dictionaries')
  ctx.effect(() => ctx.inputTriggers.registerSource(source.source), 'ui-vscode: ide-context source')
  ctx.effect(() => () => { source.dispose() }, 'ui-vscode: captured context registry')

  const append = (sessionId: SessionId, snapshot: EditorContextSnapshot): boolean => {
    const actx = ctx.sessions.scope(sessionId)
    /* v8 ignore next -- the session-scoped slot is pruned before its scope can disappear. */
    if (actx === undefined) throw new Error(`ui-vscode: session "${sessionId}" resolved no scope`)
    const conversation: IConversation | undefined = actx.get('conversation')
    /* v8 ignore next -- Cordis injects conversation before this plugin and every registered session scope inherits it. */
    if (conversation === undefined) throw new Error('ui-vscode: conversation service is unavailable')
    const reference = source.remember(snapshot, contextLabel(snapshot, t('context.chip.diagnostics')))
    const accepted = conversation.appendReference(reference)
    if (!accepted) source.forget(snapshot.id)
    return accepted
  }

  const captureSnapshot = async (
    sessionId: SessionId,
    kind: EditorCaptureKind,
  ): Promise<boolean> => {
    let snapshot: EditorContextSnapshot | null
    switch (kind) {
      case 'selection': snapshot = await ide.request('editor.captureSelection', {}); break
      case 'file': snapshot = await ide.request('editor.captureFile', {}); break
      case 'diagnostics': snapshot = await ide.request('editor.captureDiagnostics', {}); break
    }
    if (snapshot === null) return false
    if (!append(sessionId, snapshot)) throw new Error(t('context.busy'))
    return true
  }

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'vscode-context',
    order: 20,
    locale: NS,
    inject: (sessionId: SessionId): ContextButtonInjected => ({
      capture: kind => captureSnapshot(sessionId, kind),
    }),
  }, ContextButton))

  const selectRoot = (workspaceRoot: string): void => {
    void selection.select(workspaceRoot).catch((reason: unknown) => {
      notifyCurrent(ctx, `${t('workspace.failed')} ${reason instanceof Error ? reason.message : String(reason)}`)
    })
  }

  ctx.effect(() => {
    const disposers = [
      ide.handle('webview.getTurnState', () => {
        const current = ctx.sessions.list.getSnapshot().current
        const running = current === undefined
          ? false
          : ctx.sessions.binding(current)?.session.getSnapshot().running === true
        return { running }
      }),
      ide.handle('webview.newSession', () => {
        ctx.workspaces.startSession()
        return {}
      }),
      ide.subscribeEvents((event) => {
        if (event.event === 'workspace.selected') {
          selectRoot(event.payload.workspaceRoot)
          return
        }
        if (event.event !== 'editor.contextCaptured') return
        const current = ctx.sessions.list.getSnapshot().current
        if (current === undefined) return
        try {
          if (!append(current, event.payload.snapshot)) notifyCurrent(ctx, t('context.busy'))
        } catch (reason) {
          notifyCurrent(ctx, `${t('context.failed')} ${reason instanceof Error ? reason.message : String(reason)}`)
        }
      }),
    ]
    void ide.request('workspace.getSelectedRoot', {}).then(({ workspaceRoot }) => {
      selectRoot(workspaceRoot)
    }, (reason: unknown) => {
      notifyCurrent(ctx, `${t('workspace.failed')} ${reason instanceof Error ? reason.message : String(reason)}`)
    })
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-vscode: IDE methods and events')
}
