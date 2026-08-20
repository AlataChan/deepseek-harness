/** Real VS Code Extension Development Host integration assertions. */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { EditorContextSnapshot } from '@deepseek-ai/dsh-client-connection-vscode/protocol'
import { RpcId, type ClientRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import * as vscode from 'vscode'
import {
  createVsCodeHostRpc,
  type HarnessExtensionApi,
} from '../../extension.ts'

const READY_TIMEOUT_MS = 60_000

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is required`)
  return value
}

async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = READY_TIMEOUT_MS,
  status?: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      const detail = status === undefined ? '' : ` (${status()})`
      throw new Error(`timed out waiting for ${description}${detail}`)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

/** Exercise the installed extension, retained view, editor capture, opener, and shutdown. */
export async function runExtensionIntegration(): Promise<void> {
  const extensionId = requiredEnvironment('DSH_VSCODE_TEST_EXTENSION_ID')
  const runtimePath = requiredEnvironment('DSH_VSCODE_TEST_RUNTIME')
  const nodePath = requiredEnvironment('DSH_VSCODE_TEST_NODE')
  const dshHome = requiredEnvironment('DSH_VSCODE_TEST_HOME')
  const workspace = vscode.workspace.workspaceFolders?.[0]
  assert.ok(workspace, 'fixture workspace must be open')

  const configuration = vscode.workspace.getConfiguration('harnessClient')
  await configuration.update('runtimePath', runtimePath, vscode.ConfigurationTarget.Workspace)
  await configuration.update('nodePath', nodePath, vscode.ConfigurationTarget.Workspace)
  await configuration.update('runtime.restartAttempts', 0, vscode.ConfigurationTarget.Workspace)

  const extension = vscode.extensions.getExtension<HarnessExtensionApi>(extensionId)
  assert.ok(extension, `staged extension ${extensionId} must be installed`)
  const api = await extension.activate()

  try {
    const mainUri = vscode.Uri.joinPath(workspace.uri, 'src', 'main.ts')
    const mainDocument = await vscode.workspace.openTextDocument(mainUri)
    const mainEditor = await vscode.window.showTextDocument(mainDocument)
    mainEditor.selection = new vscode.Selection(0, 13, 0, 26)

    const commands = await vscode.commands.getCommands(true)
    assert.ok(commands.includes('harnessClient.panel.focus'), 'VS Code must register the contributed view focus command')
    await vscode.commands.executeCommand('harnessClient.focus')
    await vscode.commands.executeCommand('harnessClient.panel.focus')
    await waitFor(
      () => api.runtimeState() === 'ready' && api.webviewReady(),
      'Harness Webview readiness',
      READY_TIMEOUT_MS,
      () => `runtime=${api.runtimeState()}, webview=${String(api.webviewReady())}, failure=${api.runtimeFailure() ?? 'none'}`,
    )
    assert.equal(api.selectedWorkspaceRoot(), workspace.uri.fsPath)

    const selection = await vscode.commands.executeCommand<EditorContextSnapshot>(
      'harnessClient.addSelection',
    )
    assert.ok(selection)
    assert.equal(selection.kind, 'selection')
    assert.equal(selection.workspacePath, 'src/main.ts')
    assert.equal(selection.text, 'selectedValue')
    assert.deepEqual(selection.range, {
      startLine: 0,
      startColumn: 13,
      endLine: 0,
      endColumn: 26,
    })

    await vscode.commands.executeCommand('workbench.view.explorer')
    await new Promise(resolve => setTimeout(resolve, 500))
    assert.equal(api.runtimeState(), 'ready', 'hiding the retained view must not stop its companion')
    assert.equal(api.webviewReady(), true)
    await vscode.commands.executeCommand('harnessClient.focus')

    const file = await vscode.commands.executeCommand<EditorContextSnapshot>('harnessClient.addFile')
    assert.ok(file)
    assert.equal(file.kind, 'file')
    assert.equal(file.workspacePath, 'src/main.ts')
    assert.equal(file.text, "export const selectedValue = 'editor-context'\n")

    const hostRpc = createVsCodeHostRpc(() => workspace.uri)
    try {
      const request: ClientRequest = {
        type: 'client-request',
        rpcId: RpcId('extension-integration-open'),
        method: 'host.openPath',
        payload: { path: join(workspace.uri.fsPath, 'src', 'target.ts') + ':2:3' },
      }
      const response = await hostRpc.interceptRequest(request, new AbortController().signal)
      assert.ok(response?.result.ok)
      await waitFor(
        () => vscode.window.activeTextEditor?.document.uri.fsPath === join(workspace.uri.fsPath, 'src', 'target.ts'),
        'opened target document',
      )
      const editor = vscode.window.activeTextEditor
      assert.ok(editor)
      assert.equal(editor.selection.start.line, 1)
      assert.equal(editor.selection.start.character, 2)
    } finally {
      hostRpc.dispose()
    }
  } finally {
    await api.shutdown()
    await waitFor(() => api.runtimeState() === 'idle', 'companion shutdown')
    await waitFor(
      () => !existsSync(join(dshHome, '.locks', 'vscode-companion.lock')),
      'companion lease release',
      10_000,
    )
  }
}
