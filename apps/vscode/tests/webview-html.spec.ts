/** Secure Webview HTML bootstrap. */

import { describe, expect, it } from 'vitest'
import { createWebviewHtml, decodeWebviewBoot } from '../src/webview-html.ts'

describe('VS Code Webview HTML', () => {
  it('uses an external nonce-free script under a strict CSP and encodes boot values as inert metadata', () => {
    const boot = {
      graph: { rev: 'graph', entries: [] },
      locale: 'zh-cn',
      maxLogicalRpcBytes: 1024,
    }
    const html = createWebviewHtml({
      boot,
      cspSource: 'vscode-webview://test',
      scriptUri: 'vscode-webview://test/media/main.js',
      title: 'Harness Client',
    })
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('script-src vscode-webview://test')
    expect(html).not.toMatch(/script-src[^;]*(?:'unsafe-inline'|'unsafe-eval')/)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain(JSON.stringify(boot))
    expect(decodeWebviewBoot(html)).toEqual(boot)
  })
})
