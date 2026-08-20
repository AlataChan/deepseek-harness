/** Activity-view retention and disposal ownership. */

import type * as vscode from 'vscode'
import { describe, expect, it, vi } from 'vitest'
import { RuntimeOutput } from '../src/output.ts'
import { RuntimeManager } from '../src/runtime-manager.ts'
import {
  HarnessWebviewProvider,
  registerRetainedWebview,
} from '../src/webview-provider.ts'

describe('VS Code Webview lifecycle', () => {
  it('registers retainContextWhenHidden and does not dispose on hide/reveal', () => {
    const dispose = vi.fn()
    const registration = { dispose }
    const register = vi.fn(() => registration)
    const provider = { resolveWebviewView: vi.fn() }
    const result = registerRetainedWebview(register, 'harnessClient.panel', provider)
    expect(register).toHaveBeenCalledWith('harnessClient.panel', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
    expect(dispose).not.toHaveBeenCalled()
    result.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('renders an inert document without resolving a runtime in an untrusted workspace', async () => {
    const resolveRuntime = vi.fn(async () => { throw new Error('must remain lazy') })
    const manager = new RuntimeManager({ resolveRuntime, extensionVersion: '0.1.0' })
    const output = new RuntimeOutput({ appendLine: vi.fn(), show: vi.fn(), dispose: vi.fn() })
    let trusted = false
    const showError = vi.fn()
    const provider = new HarnessWebviewProvider(manager, output, {
      extensionUri: { fsPath: '/extension' } as vscode.Uri,
      globalStorageUri: { fsPath: '/storage' } as vscode.Uri,
      locale: 'en',
      title: 'Harness Client',
      untrustedMessage: 'Trust this workspace.',
      noWorkspaceMessage: 'Select a workspace folder.',
      isTrusted: () => trusted,
      workspaceFolders: () => ['/workspace'],
      pickWorkspace: vi.fn(),
      confirmRestart: vi.fn(),
      fileUri: path => ({ fsPath: path }) as vscode.Uri,
      joinUri: base => base,
      showError,
      createHostRpc: () => ({
        interceptRequest: async () => undefined,
        interceptResponse: response => response,
        dispose: vi.fn(),
      }),
    })
    expect(() => provider.selectedWorkspaceRoot()).toThrow('no selected workspace')
    await expect(provider.addEditorContext({} as never)).rejects.toThrow('Webview is not ready')
    const webview = { options: {}, html: '' }
    const view = {
      webview,
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as vscode.WebviewView
    await provider.resolveWebviewView(view)
    expect(resolveRuntime).not.toHaveBeenCalled()
    expect(webview.options).toEqual({ enableScripts: false, localResourceRoots: [] })
    expect(webview.html).toContain('Trust this workspace.')
    expect(webview.html).toContain("default-src 'none'")
    trusted = true
    await provider.workspaceTrusted()
    expect(resolveRuntime).toHaveBeenCalledOnce()
    expect(showError).toHaveBeenCalledWith('must remain lazy')
    await provider.shutdown()
  })
})
