import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyDesktopWebviewAssets } from './verify-desktop-webview.ts'

function fixture(source: string, name = 'chunk.js'): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-webview-'))
  mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(root, 'assets', name), source)
  return root
}

describe('verifyDesktopWebviewAssets', () => {
  it('rejects a fixture asset containing eval, Function, or process.env and names the file', () => {
    const evalDir = fixture('eval("1")\n')
    expect(verifyDesktopWebviewAssets(evalDir)).toEqual([
      'assets/chunk.js: WebView script contains CSP-forbidden dynamic code',
    ])
    const fnDir = fixture('new Function("return 1")()\n')
    expect(verifyDesktopWebviewAssets(fnDir)).toEqual([
      'assets/chunk.js: WebView script contains CSP-forbidden dynamic code',
    ])
    const processDir = fixture('process.env.NODE_ENV\n')
    expect(verifyDesktopWebviewAssets(processDir)).toEqual([
      'assets/chunk.js: WebView script contains the Node process global',
    ])
  })

  it('accepts an asset without those constructs', () => {
    const root = fixture('const ready = true\n')
    expect(verifyDesktopWebviewAssets(root)).toEqual([])
  })
})
