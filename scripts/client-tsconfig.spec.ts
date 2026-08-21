/** Regression coverage for source declarations owned by the client test aggregate. */

import { existsSync, readdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

function clientCssDeclarations(): string[] {
  const clientGroups = ['client', 'extensions']
  return clientGroups.flatMap((group) => {
    const clientRoot = resolve(root, 'packages', group)
    return readdirSync(clientRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => resolve(clientRoot, entry.name, 'src/css-modules.d.ts'))
  })
    .filter(existsSync)
    .map(file => file.replaceAll(sep, '/'))
    .sort()
}

describe('client TypeScript aggregate', () => {
  it('loads package CSS declarations without relying on workspace-link realpaths', () => {
    const configPath = resolve(root, 'tsconfig.client.json')
    const read = ts.readConfigFile(configPath, file => ts.sys.readFile(file))
    if (read.error !== undefined) {
      throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
    }
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root)
    const loaded = parsed.fileNames
      .map(file => file.replaceAll(sep, '/'))
      .filter(file => file.endsWith('/src/css-modules.d.ts'))
      .sort()
    expect(loaded).toEqual(clientCssDeclarations())
  })

  it('keeps node-only ui tsx tests in the Host aggregate', () => {
    const host = ts.readConfigFile(resolve(root, 'tsconfig.host.json'), file => ts.sys.readFile(file))
    const client = ts.readConfigFile(resolve(root, 'tsconfig.client.json'), file => ts.sys.readFile(file))
    if (host.error !== undefined || client.error !== undefined) {
      throw new Error('failed to read a TypeScript aggregate')
    }
    const hostConfig = host.config as unknown as {
      compilerOptions?: { jsx?: unknown }
      include?: unknown[]
    }
    const clientConfig = client.config as unknown as { include?: unknown[] }

    expect(hostConfig.compilerOptions?.jsx).toBe('react-jsx')
    expect(hostConfig.include).toContain('packages/ui/*/tests/**/*.tsx')
    expect(clientConfig.include).not.toContain('packages/ui/*/tests/**/*.tsx')
  })
})
