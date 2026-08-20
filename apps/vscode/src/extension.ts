/** Harness Client VS Code workspace-extension activation. */

import * as vscode from 'vscode'
import { validateContextLimits } from './bridge-router.ts'
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
  validateContextLimits({
    maxSelectionBytes: configuration.get<number>('context.maxSelectionBytes', 131_072),
    maxFileBytes: configuration.get<number>('context.maxFileBytes', 524_288),
    maxDiagnostics: configuration.get<number>('context.maxDiagnostics', 200),
  })
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
  const provider = new HarnessWebviewProvider(manager, output, {
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
    ideHandlers: {
      'runtime.restart': async () => { await provider.restartRuntime(); return { accepted: true } },
      'logs.show': () => { output.show(); return {} },
    },
  })
  const commands: [string, () => unknown][] = [
    ['harnessClient.focus', () => vscode.commands.executeCommand(`${VIEW_ID}.focus`)],
    ['harnessClient.newSession', () => provider.newSession()],
    ['harnessClient.addSelection', () => vscode.window.showInformationMessage(
      vscode.l10n.t('Editor context is not available until the VS Code context plugin loads.'),
    )],
    ['harnessClient.addFile', () => vscode.window.showInformationMessage(
      vscode.l10n.t('Editor context is not available until the VS Code context plugin loads.'),
    )],
    ['harnessClient.addProblems', () => vscode.window.showInformationMessage(
      vscode.l10n.t('Editor context is not available until the VS Code context plugin loads.'),
    )],
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
