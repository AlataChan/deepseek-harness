/** Extension manifest and runtime localization completeness. */

import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeVsCodeLocale } from '../src/webview-html.ts'

const readJson = (relative: string): Record<string, unknown> => JSON.parse(readFileSync(
  new URL(`../${relative}`, import.meta.url), 'utf8',
)) as Record<string, unknown>

describe('VS Code localization', () => {
  it('declares lazy activation and trust-restricted executable settings', () => {
    const manifest = readJson('manifest.vscode.json')
    expect(manifest.activationEvents).not.toContain('*')
    expect(manifest.publisher).toBe('__PUBLISHER_ID__')
    expect(manifest).toMatchObject({
      capabilities: {
        untrustedWorkspaces: {
          supported: 'limited',
          restrictedConfigurations: [
            'harnessClient.runtimePath',
            'harnessClient.nodePath',
          ],
        },
      },
    })
    expect(manifest).not.toHaveProperty('restrictedConfigurations')
  })

  it('keeps English and Chinese manifest key sets identical', () => {
    const english = readJson('package.nls.json')
    const chinese = readJson('package.nls.zh-cn.json')
    expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort())
    const references = [...JSON.stringify(readJson('manifest.vscode.json')).matchAll(/%([^%]+)%/g)]
      .map(match => match[1])
    expect(references.every(key => key !== undefined && Object.hasOwn(english, key))).toBe(true)
  })

  it('keeps English and Chinese runtime bundle key sets identical', () => {
    const english = readJson('l10n/bundle.l10n.json')
    const chinese = readJson('l10n/bundle.l10n.zh-cn.json')
    expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort())
    const extension = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8')
    const references = [...extension.matchAll(/vscode\.l10n\.t\('([^']+)'\)/g)].map(match => match[1])
    expect(references.every(key => key !== undefined && Object.hasOwn(english, key))).toBe(true)
  })

  it('maps every Chinese regional locale to zh and all other locales to en', () => {
    expect(normalizeVsCodeLocale('zh-cn')).toBe('zh')
    expect(normalizeVsCodeLocale('zh-Hans-CN')).toBe('zh')
    expect(normalizeVsCodeLocale('en-GB')).toBe('en')
    expect(normalizeVsCodeLocale('ja')).toBe('en')
  })

  it('keeps the raw VS Code API acquisition in the Webview bootstrap only and calls it once', () => {
    const root = new URL('../src/', import.meta.url)
    const files = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name)))
      .map(entry => readFileSync(join(entry.parentPath, entry.name), 'utf8'))
    expect(files.join('\n').match(/\bacquireVsCodeApi\(\)/g)).toHaveLength(1)
  })
})
