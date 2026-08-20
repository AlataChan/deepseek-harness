/** Marketplace manifest and staged-extension payload verification. */

import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyExtensionDirectory } from '../scripts/verify-extension-manifest.ts'

const temporaryRoots: string[] = []

const validManifest = {
  name: 'harness-client',
  displayName: 'Harness Client for VS Code',
  publisher: 'harness-client-tests',
  version: '0.1.0',
  icon: 'media/icon.png',
  main: './dist/extension.js',
  l10n: './l10n',
  contributes: {
    commands: [{ command: 'harnessClient.focus', title: '%command.focus%' }],
  },
  harnessClient: {
    releaseChannel: 'pre-release',
    companion: {
      required: true,
      package: '@deepseek-ai/dsh',
      profile: 'vscode',
      bundled: false,
    },
  },
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function createValidExtension(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-vscode-package-'))
  temporaryRoots.push(root)
  await Promise.all([
    mkdir(join(root, 'dist', 'webview'), { recursive: true }),
    mkdir(join(root, 'l10n'), { recursive: true }),
    mkdir(join(root, 'media'), { recursive: true }),
  ])
  await Promise.all([
    writeJson(join(root, 'package.json'), validManifest),
    writeJson(join(root, 'package.nls.json'), { 'command.focus': 'Harness Client: Focus' }),
    writeJson(join(root, 'package.nls.zh-cn.json'), { 'command.focus': '聚焦 Harness Client' }),
    writeJson(join(root, 'l10n', 'bundle.l10n.json'), { Ready: 'Ready' }),
    writeJson(join(root, 'l10n', 'bundle.l10n.zh-cn.json'), { Ready: '就绪' }),
    writeFile(join(root, 'dist', 'extension.js'), 'export {}\n'),
    writeFile(join(root, 'dist', 'webview', 'main.js'), 'export {}\n'),
    writeFile(join(root, 'dist', 'webview', 'main.css'), ':root {}\n'),
    writeFile(join(root, 'media', 'activity.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n'),
    writeFile(join(root, 'media', 'icon.png'), new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10,
      0, 0, 0, 13, 73, 72, 68, 82,
      0, 0, 0, 128, 0, 0, 0, 128,
    ])),
    writeFile(join(root, 'README.md'), '# Harness Client\n'),
    writeFile(join(root, 'LICENSE'), 'MIT\n'),
  ])
  return root
}

async function replaceManifest(root: string, mutate: (manifest: typeof validManifest) => void): Promise<void> {
  const manifest = structuredClone(validManifest)
  mutate(manifest)
  await writeJson(join(root, 'package.json'), manifest)
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('VS Code extension packaging', () => {
  it('accepts the declared external-companion artifact', async () => {
    const root = await createValidExtension()
    await expect(verifyExtensionDirectory(root)).resolves.toBeUndefined()
  })

  it.each([
    ['Function constructor', 'new Function("return 1")()'],
    ['direct eval', 'eval("1")'],
  ])('rejects CSP-forbidden %s in a Webview chunk', async (_label, source) => {
    const root = await createValidExtension()
    await writeFile(join(root, 'dist', 'webview', 'chunk.js'), `${source}\n`)
    await expect(verifyExtensionDirectory(root)).rejects.toThrow(/webview.*dynamic code/i)
  })

  it.each([
    ['publisher', /publisher.*placeholder/i, (manifest: typeof validManifest) => { manifest.publisher = '__PUBLISHER_ID__' }],
    ['display name', /displayName.*placeholder/i, (manifest: typeof validManifest) => { manifest.displayName = '__DISPLAY_NAME__' }],
    ['icon', /icon.*placeholder/i, (manifest: typeof validManifest) => { manifest.icon = '__ICON__' }],
    ['release channel', /releaseChannel.*placeholder/i, (manifest: typeof validManifest) => { manifest.harnessClient.releaseChannel = '__RELEASE_CHANNEL__' }],
  ] as const)('rejects a placeholder %s', async (_label, expected, mutate) => {
    const root = await createValidExtension()
    await replaceManifest(root, mutate)
    await expect(verifyExtensionDirectory(root)).rejects.toThrow(expected)
  })

  it('rejects an unresolved manifest localization key', async () => {
    const root = await createValidExtension()
    await replaceManifest(root, (manifest) => {
      manifest.contributes.commands[0]!.title = '%command.missing%'
    })
    await expect(verifyExtensionDirectory(root)).rejects.toThrow(/command\.missing.*package\.nls\.json/)
  })

  it('rejects a missing Chinese locale resource', async () => {
    const root = await createValidExtension()
    await unlink(join(root, 'package.nls.zh-cn.json'))
    await expect(verifyExtensionDirectory(root)).rejects.toThrow(/package\.nls\.zh-cn\.json.*missing/)
  })

  it('rejects a bundled Harness runtime', async () => {
    const root = await createValidExtension()
    const runtime = join(root, 'node_modules', '@deepseek-ai', 'dsh')
    await mkdir(runtime, { recursive: true })
    await writeJson(join(runtime, 'package.json'), { name: '@deepseek-ai/dsh' })
    await expect(verifyExtensionDirectory(root)).rejects.toThrow(/must not bundle.*Harness runtime/i)
  })

  it('rejects an undeclared installed-companion requirement', async () => {
    const root = await createValidExtension()
    await replaceManifest(root, (manifest) => {
      Reflect.deleteProperty(manifest, 'harnessClient')
    })
    await expect(verifyExtensionDirectory(root)).rejects.toThrow(/installed companion requirement/i)
  })
})
