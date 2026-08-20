/** Harness Client VS Code workspace-extension activation. */

import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import { validateContextLimits } from './bridge-router.ts'
import { EditorContextCapture, type EditorCaptureKind } from './editor-context.ts'
import { HostRpcInterceptor } from './host-rpc-interceptor.ts'
import { launchIpcChild } from './ipc-child.ts'
import { RuntimeOutput } from './output.ts'
import { RuntimeManager } from './runtime-manager.ts'
import { resolveInstalledRuntime } from './runtime-resolver.ts'
import {
  HarnessWebviewProvider,
  registerRetainedWebview,
} from './webview-provider.ts'

const VIEW_ID = 'harnessClient.panel'

interface ActiveExtension {
  provider: HarnessWebviewProvider
  output: RuntimeOutput
}

let activeExtension: ActiveExtension | undefined

function configuredString(configuration: vscode.WorkspaceConfiguration, key: string): string | undefined {
  const value = configuration.get<string>(key, '').trim()
  return value === '' ? undefined : value
}

function extensionVersion(context: vscode.ExtensionContext): string {
  const manifest = context.extension.packageJSON as { version?: unknown }
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error('Harness Client extension version is missing')
  }
  return manifest.version
}

async function showCommandError(output: RuntimeOutput, reason: unknown): Promise<void> {
  const message = reason instanceof Error ? reason.message : String(reason)
  output.appendDiagnostic(message)
  await vscode.window.showErrorMessage(message)
}

/** Activate commands and the retained provider without starting a companion. */
export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel(vscode.l10n.t('Harness runtime logs'))
  const output = new RuntimeOutput(channel)
  const configuration = vscode.workspace.getConfiguration('harnessClient')
  const contextLimits = validateContextLimits({
    maxSelectionBytes: configuration.get<number>('context.maxSelectionBytes', 131_072),
    maxFileBytes: configuration.get<number>('context.maxFileBytes', 524_288),
    maxDiagnostics: configuration.get<number>('context.maxDiagnostics', 200),
  })
  const editorContext = new EditorContextCapture({
    activeEditor: () => {
      const editor = vscode.window.activeTextEditor
      if (editor === undefined) return undefined
      return {
        document: {
          uri: editor.document.uri,
          languageId: editor.document.languageId,
          version: editor.document.version,
          getText: range => editor.document.getText(range as vscode.Range | undefined),
        },
        selection: editor.selection,
      }
    },
    diagnostics: uri => vscode.languages.getDiagnostics(uri as vscode.Uri).map(diagnostic => ({
      range: diagnostic.range,
      severity: diagnostic.severity,
      message: diagnostic.message,
      ...(diagnostic.source === undefined ? {} : { source: diagnostic.source }),
      ...(diagnostic.code === undefined ? {} : { code: diagnostic.code }),
    })),
    randomId: randomUUID,
    now: Date.now,
  }, contextLimits)
  const manager = new RuntimeManager({
    extensionVersion: extensionVersion(context),
    restartAttempts: configuration.get<number>('runtime.restartAttempts', 2),
    shutdownTimeoutMs: configuration.get<number>('runtime.shutdownTimeoutMs', 5_000),
    resolveRuntime: () => {
      const current = vscode.workspace.getConfiguration('harnessClient')
      const runtimePath = configuredString(current, 'runtimePath')
      const nodePath = configuredString(current, 'nodePath')
      return resolveInstalledRuntime({
        ...(runtimePath === undefined ? {} : { runtimePath }),
        ...(nodePath === undefined ? {} : { nodePath }),
      })
    },
    launchChild: (runtime, root) => launchIpcChild(runtime, root, {
      onStdout: (chunk) => { output.appendProcessChunk('stdout', chunk) },
      onStderr: (chunk) => { output.appendProcessChunk('stderr', chunk) },
    }),
  })
  const provider: HarnessWebviewProvider = new HarnessWebviewProvider(manager, output, {
    extensionUri: context.extensionUri,
    globalStorageUri: context.globalStorageUri,
    locale: vscode.env.language,
    title: vscode.l10n.t('Harness Client'),
    untrustedMessage: vscode.l10n.t('Trust this workspace before starting Harness Client.'),
    noWorkspaceMessage: vscode.l10n.t('Select a workspace folder to start Harness Client.'),
    isTrusted: () => vscode.workspace.isTrusted,
    workspaceFolders: () => vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [],
    pickWorkspace: async (folders) => {
      const selected = await vscode.window.showQuickPick(
        folders.map(path => ({ label: vscode.workspace.asRelativePath(path, false), description: path, path })),
        { placeHolder: vscode.l10n.t('Select a workspace folder') },
      )
      return selected?.path
    },
    confirmRestart: async () => await vscode.window.showWarningMessage(
      vscode.l10n.t('A turn is running. Restart the runtime and interrupt it?'),
      { modal: true },
      vscode.l10n.t('Restart'),
    ) === vscode.l10n.t('Restart'),
    fileUri: path => vscode.Uri.file(path),
    joinUri: (base, ...segments) => vscode.Uri.joinPath(base, ...segments),
    showError: async message => await vscode.window.showErrorMessage(message),
    createHostRpc: () => new HostRpcInterceptor({
      workspaceRoot: () => {
        const root = provider.selectedWorkspaceRoot()
        return vscode.workspace.workspaceFolders?.find(folder => folder.uri.fsPath === root)?.uri
          ?? vscode.Uri.file(root)
      },
      parseUri: value => vscode.Uri.parse(value, true),
      fileUri: path => vscode.Uri.file(path),
      joinUri: (base, path) => vscode.Uri.joinPath(base as vscode.Uri, path),
      stat: async (uri) => {
        const stat = await vscode.workspace.fs.stat(uri as vscode.Uri)
        if ((stat.type & vscode.FileType.SymbolicLink) !== 0) return 'symbolic-link'
        if ((stat.type & vscode.FileType.Directory) !== 0) return 'directory'
        if ((stat.type & vscode.FileType.File) !== 0) return 'file'
        throw new Error('path is neither a file nor a directory')
      },
      openTextDocument: async uri => await vscode.workspace.openTextDocument(uri as vscode.Uri),
      showTextDocument: async (document, options) => await vscode.window.showTextDocument(
        document as vscode.TextDocument,
        options as vscode.TextDocumentShowOptions,
      ),
      pointRange: (line, column) => new vscode.Range(line, column, line, column),
      revealInExplorer: async uri => await vscode.commands.executeCommand('revealInExplorer', uri),
    }),
    ideHandlers: {
      'workspace.getSelectedRoot': (): { workspaceRoot: string } => ({
        workspaceRoot: provider.selectedWorkspaceRoot(),
      }),
      'editor.captureSelection': () => editorContext.selection(provider.selectedWorkspaceRoot()),
      'editor.captureFile': () => editorContext.file(provider.selectedWorkspaceRoot()),
      'editor.captureDiagnostics': () => editorContext.diagnostics(provider.selectedWorkspaceRoot()),
      'runtime.restart': async () => { await provider.restartRuntime(); return { accepted: true } },
      'logs.show': () => { output.show(); return {} },
    },
  })
  const addEditorContext = async (kind: EditorCaptureKind): Promise<void> => {
    const root = provider.selectedWorkspaceRoot()
    const snapshot = kind === 'selection'
      ? editorContext.selection(root)
      : kind === 'file'
        ? editorContext.file(root)
        : editorContext.diagnostics(root)
    if (snapshot === null) {
      await vscode.window.showInformationMessage(vscode.l10n.t('No editor context is available to add.'))
      return
    }
    await provider.addEditorContext(snapshot)
  }
  const commands: [string, () => unknown][] = [
    ['harnessClient.focus', () => vscode.commands.executeCommand(`${VIEW_ID}.focus`)],
    ['harnessClient.newSession', () => provider.newSession()],
    ['harnessClient.addSelection', () => addEditorContext('selection')],
    ['harnessClient.addFile', () => addEditorContext('file')],
    ['harnessClient.addProblems', () => addEditorContext('diagnostics')],
    ['harnessClient.selectWorkspace', () => provider.selectWorkspace()],
    ['harnessClient.restartRuntime', () => provider.restartRuntime()],
    ['harnessClient.showLogs', () => { output.show() }],
  ]
  context.subscriptions.push(registerRetainedWebview(
    (viewId, webviewProvider, options) => vscode.window.registerWebviewViewProvider(
      viewId, webviewProvider as vscode.WebviewViewProvider, options,
    ),
    VIEW_ID,
    provider,
  ))
  context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => {
    void provider.workspaceTrusted().catch((reason: unknown) => showCommandError(output, reason))
  }))
  for (const [id, command] of commands) {
    context.subscriptions.push(vscode.commands.registerCommand(id, () => {
      try {
        const result = command()
        if (result instanceof Promise) void result.catch((reason: unknown) => showCommandError(output, reason))
      } catch (reason) {
        void showCommandError(output, reason)
      }
    }))
  }
  activeExtension = { provider, output }
}

/** Drain extension-owned resources during deactivation. */
export async function deactivate(): Promise<void> {
  const active = activeExtension
  activeExtension = undefined
  if (active === undefined) return
  await active.provider.shutdown()
  active.output.dispose()
}
