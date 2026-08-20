/** Retained activity-bar Webview registration and extension-owned disposal. */

import { join } from 'node:path'
import type * as vscode from 'vscode'
import type { EditorContextSnapshot } from '@deepseek-ai/dsh-client-connection-vscode/protocol'
import type { IdeHandlers } from './bridge-router.ts'
import type { HostRpcRouting } from './host-rpc-interceptor.ts'
import { BridgeRouter, cacheVerifiedBundles } from './bridge-router.ts'
import type { RuntimeOutput } from './output.ts'
import type { RuntimeManager } from './runtime-manager.ts'
import { createWebviewHtml } from './webview-html.ts'
import { chooseInitialWorkspace, chooseReplacementWorkspace } from './workspace-selector.ts'

/** Minimal disposable returned by VS Code registrations. */
export interface DisposableLike {
  /** Release the registration. */
  dispose(): void
}

/** Webview registration call surface used by activation and unit tests. */
export type WebviewRegistration = (
  viewId: string,
  provider: unknown,
  options: { webviewOptions: { retainContextWhenHidden: true } },
) => DisposableLike

/**
 * Register one activity view whose live DOM, Cordis tree, draft, and chips survive hiding.
 * @param register - VS Code's `registerWebviewViewProvider` method.
 * @param viewId - manifest-declared activity view id.
 * @param provider - extension-owned provider instance.
 * @returns the VS Code registration disposable.
 */
export function registerRetainedWebview(
  register: WebviewRegistration,
  viewId: string,
  provider: unknown,
): DisposableLike {
  return register(viewId, provider, { webviewOptions: { retainContextWhenHidden: true } })
}

/** VS Code API ports retained as callbacks so unit tests never load the runtime module. */
export interface HarnessWebviewProviderPorts {
  /** Extension installation URI. */
  extensionUri: vscode.Uri
  /** Extension global-storage URI. */
  globalStorageUri: vscode.Uri
  /** Current VS Code display locale. */
  locale: string
  /** Localized panel document title. */
  title: string
  /** Localized untrusted-workspace message. */
  untrustedMessage: string
  /** Localized message shown when the window has no workspace folder. */
  noWorkspaceMessage: string
  /** Current workspace trust state. */
  isTrusted: () => boolean
  /** Absolute roots attached to the current VS Code window. */
  workspaceFolders: () => readonly string[]
  /** Multiple-root picker. */
  pickWorkspace: (folders: readonly string[]) => Promise<string | undefined>
  /** Disruptive restart confirmation. */
  confirmRestart: () => Promise<boolean>
  /** Convert an absolute filesystem path to a VS Code URI. */
  fileUri: (path: string) => vscode.Uri
  /** Join a URI with extension-relative segments. */
  joinUri: (base: vscode.Uri, ...segments: string[]) => vscode.Uri
  /** Surface an actionable startup failure. */
  showError: (message: string) => Promise<unknown>
  /** Extension-owned IDE method handlers. */
  ideHandlers?: IdeHandlers
  /** Create one Host RPC interceptor for each mounted bridge generation. */
  createHostRpc(): HostRpcRouting
}

function errorDocument(message: string): string {
  const text = message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\';">'
    + '</head><body><p>' + text + '</p></body></html>'
}

/** Activity-view provider that starts the installed runtime only when the view resolves. */
export class HarnessWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined
  private router: BridgeRouter | undefined
  private viewDisposer: vscode.Disposable | undefined
  private stateDisposer: (() => void) | undefined
  private workspaceRoot: string | undefined
  private graphRevision: string | undefined
  private disposed = false

  /**
   * @param runtime - stable companion manager shared by this extension window.
   * @param output - redacted process and lifecycle output.
   * @param ports - VS Code URI, trust, selection, localization, and UI callbacks.
   */
  constructor(
    private readonly runtime: RuntimeManager,
    private readonly output: RuntimeOutput,
    private readonly ports: HarnessWebviewProviderPorts,
  ) {}

  /** Resolve one retained view and lazily start its selected-root companion. */
  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    if (this.disposed) return
    await this.releaseView(true)
    this.view = view
    this.viewDisposer = view.onDidDispose(() => { void this.releaseView(true, false) })
    if (!this.ports.isTrusted()) {
      view.webview.options = { enableScripts: false, localResourceRoots: [] }
      view.webview.html = errorDocument(this.ports.untrustedMessage)
      return
    }
    try {
      const selected = await chooseInitialWorkspace({
        trusted: true,
        folders: this.ports.workspaceFolders(),
        pick: this.ports.pickWorkspace,
      })
      if (selected === undefined) {
        view.webview.options = { enableScripts: false, localResourceRoots: [] }
        view.webview.html = errorDocument(this.ports.noWorkspaceMessage)
        return
      }
      this.workspaceRoot = selected
      const ready = await this.runtime.start({ workspaceRoot: selected, locale: this.ports.locale })
      await this.mountReadyView(view, ready)
    } catch (error) {
      await this.failView(view, error)
    }
  }

  /** Ask the retained Client runtime to create a new session. */
  async newSession(): Promise<void> {
    if (this.router === undefined) throw new Error('Harness Webview is not ready')
    await this.router.requestWebview('webview.newSession', {})
  }

  /**
   * Read the root selected for the current companion generation.
   * @returns selected absolute workspace root.
   */
  selectedWorkspaceRoot(): string {
    if (this.workspaceRoot === undefined) throw new Error('Harness Webview has no selected workspace')
    return this.workspaceRoot
  }

  /** @returns whether this provider has mounted its active bridge. */
  isReady(): boolean { return this.router !== undefined }

  /**
   * Deliver one extension-command capture to the active Webview session.
   * @param snapshot - immutable extension-host editor snapshot.
   */
  addEditorContext(snapshot: EditorContextSnapshot): Promise<void> {
    if (this.router === undefined) return Promise.reject(new Error('Harness Webview is not ready'))
    return this.router.sendEvent({
      type: 'ide/event', event: 'editor.contextCaptured', payload: { snapshot },
    })
  }

  /** Re-resolve the current inert view after VS Code grants Workspace Trust. */
  async workspaceTrusted(): Promise<void> {
    const view = this.view
    if (view !== undefined && this.ports.isTrusted()) await this.resolveWebviewView(view)
  }

  /** Restart the companion without reconstructing the retained Webview. */
  async restartRuntime(): Promise<void> {
    if (this.router === undefined) throw new Error('Harness Webview is not ready')
    const ready = await this.runtime.restart()
    if (ready.graph.rev !== this.graphRevision && this.view !== undefined) {
      await this.mountReadyView(this.view, ready)
    }
  }

  /** Select another attached root, confirming only when the Webview reports a running turn. */
  async selectWorkspace(): Promise<void> {
    const current = this.workspaceRoot
    const router = this.router
    if (current === undefined || router === undefined) throw new Error('Harness Webview is not ready')
    const selected = await this.ports.pickWorkspace(this.ports.workspaceFolders())
    if (selected === undefined) return
    let turnRunning = true
    try {
      turnRunning = (await router.requestWebview('webview.getTurnState', {})).running
    } catch {
      // Before the VS Code context plugin activates, conservatively confirm
      // instead of interrupting an unobserved turn.
    }
    const accepted = await chooseReplacementWorkspace({
      current, selected, turnRunning, confirm: this.ports.confirmRestart,
    })
    if (accepted === undefined) return
    await this.runtime.stop()
    this.workspaceRoot = accepted
    const ready = await this.runtime.start({ workspaceRoot: accepted, locale: this.ports.locale })
    if (ready.graph.rev !== this.graphRevision && this.view !== undefined) {
      await this.mountReadyView(this.view, ready)
    }
    await this.router?.sendEvent({
      type: 'ide/event', event: 'workspace.selected', payload: { workspaceRoot: accepted },
    })
  }

  /** Dispose the view bridge and drain the owned companion. */
  dispose(): void { void this.releaseView(true, true) }

  /** Drain the companion and permanently close this provider. */
  shutdown(): Promise<void> { return this.releaseView(true, true) }

  private async mountReadyView(view: vscode.WebviewView, ready: Awaited<ReturnType<RuntimeManager['start']>>): Promise<void> {
    this.router?.dispose()
    this.stateDisposer?.()
    const mediaRoot = this.ports.joinUri(this.ports.extensionUri, 'dist', 'webview')
    const cache = await cacheVerifiedBundles(
      ready,
      join(this.ports.globalStorageUri.fsPath, 'client-bundles'),
      path => view.webview.asWebviewUri(this.ports.fileUri(path)).toString(),
    )
    const resourceRoot = this.ports.fileUri(cache.resourceRoot)
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot, resourceRoot],
    }
    const webviewPort = {
      postMessage: async (message: Parameters<vscode.Webview['postMessage']>[0]) =>
        await view.webview.postMessage(message),
      subscribe: (listener: (value: unknown) => void): (() => void) => {
        const disposable = view.webview.onDidReceiveMessage(listener)
        return () => { disposable.dispose() }
      },
    }
    this.router = new BridgeRouter({
      runtime: this.runtime,
      webview: webviewPort,
      hostRpc: this.ports.createHostRpc(),
      maxLogicalRpcBytes: ready.maxLogicalRpcBytes,
      ...(this.ports.ideHandlers === undefined ? {} : { ideHandlers: this.ports.ideHandlers }),
      onViolation: (error) => {
        this.output.appendDiagnostic(`bridge closed: ${error.message}`)
        void this.runtime.stop()
      },
    })
    this.stateDisposer = this.runtime.subscribeState((state) => {
      void this.router?.sendEvent({ type: 'ide/event', event: 'runtime.state', payload: { state } })
    })
    this.graphRevision = ready.graph.rev
    const scriptUri = view.webview.asWebviewUri(this.ports.joinUri(mediaRoot, 'main.js')).toString()
    const styleUri = view.webview.asWebviewUri(this.ports.joinUri(mediaRoot, 'main.css')).toString()
    view.webview.html = createWebviewHtml({
      boot: { graph: cache.graph, locale: this.ports.locale, maxLogicalRpcBytes: ready.maxLogicalRpcBytes },
      cspSource: view.webview.cspSource,
      scriptUri,
      styleUri,
      title: this.ports.title,
    })
    await this.router.sendEvent({ type: 'ide/event', event: 'runtime.state', payload: { state: 'ready' } })
  }

  private async failView(view: vscode.WebviewView, reason: unknown): Promise<void> {
    const message = reason instanceof Error ? reason.message : String(reason)
    this.output.appendDiagnostic(message)
    view.webview.options = { enableScripts: false, localResourceRoots: [] }
    view.webview.html = errorDocument(message)
    await this.ports.showError(message)
    await this.runtime.stop()
  }

  private async releaseView(stopRuntime: boolean, permanent = false): Promise<void> {
    this.router?.dispose()
    this.router = undefined
    this.stateDisposer?.()
    this.stateDisposer = undefined
    this.viewDisposer?.dispose()
    this.viewDisposer = undefined
    this.view = undefined
    this.graphRevision = undefined
    if (permanent) this.disposed = true
    if (stopRuntime) {
      await this.runtime.stop()
    }
  }
}
