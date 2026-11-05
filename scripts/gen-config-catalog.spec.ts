/** Shared schema aliases must retain the catalog's declared-field checks. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectConfigCatalog, render, type CatalogEntry } from './gen-config-catalog.ts'
import { computeTranslationPairingRecord, translationPairPaths } from './translation-pairing-record.ts'
import { generatedRegions } from './translation-pairing.ts'

const roots: string[] = []
const sharedSchema = `
import Schema from '@deepseek-ai/schemastery'
export interface LaunchConfig {
  /** Browser ownership mode. */
  mode: 'launch'
  /** Hide the launched browser. */
  headless: boolean
}
export interface AttachConfig {
  /** Browser ownership mode. */
  mode: 'attach'
  /** Existing browser address. */
  endpoint: string
}
export type BrowserConfig = LaunchConfig | AttachConfig
export const Shared = Schema.union([
  Schema.object({ mode: Schema.const('launch'), headless: Schema.boolean() }),
  Schema.object({ mode: Schema.const('attach'), endpoint: Schema.string() }),
])
`

function fixtureWriter(root: string): (path: string, value: string) => void {
  return (path, value) => {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, value)
  }
}

function fixture(schema = sharedSchema) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-config-catalog-'))
  roots.push(root)
  const write = fixtureWriter(root)
  write('tsconfig.json', JSON.stringify({ compilerOptions: {
    baseUrl: '.', module: 'ESNext', moduleResolution: 'Bundler',
    paths: { '@test/runtime/config': ['./packages/test/runtime/src/config.ts'] },
  }, include: ['packages/**/*.ts'] }))
  write('packages/test/runtime/package.json', JSON.stringify({
    name: '@test/runtime', exports: { './config': { types: './lib/types/config.d.ts', default: './lib/config.js' } },
  }))
  write('packages/test/runtime/src/index.ts', "export { Shared } from './config.ts'\n")
  write('packages/test/runtime/src/config.ts', schema)
  write('packages/test/provider/package.json', JSON.stringify({ name: '@test/provider' }))
  write('packages/test/provider/src/index.ts', `
import { Shared as SharedConfig, type BrowserConfig } from '@test/runtime/config'
export type Config = BrowserConfig
export const Config = SharedConfig
export function apply(ctx: unknown, config: Config): void {}
`)
  return { root, write }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('shared config schema catalog', () => {
  it('collects every branch through a renamed named import from a public source subpath', () => {
    const { root } = fixture()
    const provider = collectConfigCatalog(root).find(entry => entry.pkg === '@test/provider')
    expect(new Set(provider?.schemaKeys)).toEqual(new Set(['mode', 'headless', 'endpoint']))
    expect(provider?.configTypeName).toBe('Config')
    expect(provider?.pastes?.[0]?.text).toBe('export type Config = BrowserConfig')
  })

  it('rejects a schema field absent from the shared config type', () => {
    const { root } = fixture(sharedSchema.replace('headless: Schema.boolean()', 'headless: Schema.boolean(), hidden: Schema.string()'))
    expect(() => collectConfigCatalog(root)).toThrow("schema validates key 'hidden' but config type 'Config' declares no such member")
  })

  it('follows a local const alias without treating a completed branch as a cycle', () => {
    const { root } = fixture(sharedSchema.replace('export const Shared = Schema.union', 'export const Shared = Base\nconst Base = Schema.union'))
    const provider = collectConfigCatalog(root).find(entry => entry.pkg === '@test/provider')
    expect(new Set(provider?.schemaKeys)).toEqual(new Set(['mode', 'headless', 'endpoint']))
  })

  it('rejects type-only imports used as runtime schemas', () => {
    const { root, write } = fixture()
    write('packages/test/provider/src/index.ts', `
import type { Shared as SharedConfig, BrowserConfig } from '@test/runtime/config'
export type Config = BrowserConfig
export const Config = SharedConfig
export function apply(ctx: unknown, config: Config): void {}
`)
    expect(() => collectConfigCatalog(root)).toThrow("schema alias 'SharedConfig' must name a const or named value import")
  })

  it('rejects a private subpath even when TypeScript can resolve its source', () => {
    const { root, write } = fixture()
    write('packages/test/runtime/package.json', JSON.stringify({ name: '@test/runtime', exports: {} }))
    expect(() => collectConfigCatalog(root)).toThrow("does not explicitly export './config'")
  })

  it('rejects a missing source mapping', () => {
    const { root, write } = fixture()
    write('tsconfig.json', JSON.stringify({ compilerOptions: { paths: { '@test/runtime/config': ['./missing.ts'] } } }))
    expect(() => collectConfigCatalog(root)).toThrow('has no workspace source mapping')
  })

  it('rejects a source mapping into another package', () => {
    const { root, write } = fixture()
    write('tsconfig.json', JSON.stringify({ compilerOptions: {
      baseUrl: '.', paths: { '@test/runtime/config': ['./packages/test/provider/src/index.ts'] },
    } }))
    expect(() => collectConfigCatalog(root)).toThrow('must resolve inside packages/test/runtime/src')
  })

  it('rejects a schema value that the imported module does not export', () => {
    const { root } = fixture(sharedSchema.replace('export const Shared', 'const Shared'))
    expect(() => collectConfigCatalog(root)).toThrow("has no exported const 'Shared'")
  })

  it('rejects recursive const aliases', () => {
    const { root } = fixture(`${sharedSchema.slice(0, sharedSchema.indexOf('export const Shared'))}
export const Shared = Loop
const Loop = Shared
`)
    expect(() => collectConfigCatalog(root)).toThrow('cyclic schema alias')
  })

  it('rejects a dynamic schema factory instead of dropping its keys', () => {
    const { root } = fixture(`${sharedSchema.slice(0, sharedSchema.indexOf('export const Shared'))}
export const Shared = makeSchema()
`)
    expect(() => collectConfigCatalog(root)).toThrow('not a statically walkable schemastery call')
  })

  it('rejects an unresolved alias within a schema union', () => {
    const { root } = fixture(`${sharedSchema.slice(0, sharedSchema.indexOf('export const Shared'))}
export const Shared = Schema.union([MissingSchema])
`)
    expect(() => collectConfigCatalog(root)).toThrow("schema alias 'MissingSchema' must name a const or named value import")
  })
})

describe('package-local config declarations', () => {
  const localConfig = `
import Schema from '@deepseek-ai/schemastery'
export interface Config {
  /** Worker limit. */
  workers: number
}
export const NodeConfig = Schema.object({ workers: Schema.number() })
`
  function localRoot() {
    const root = mkdtempSync(join(tmpdir(), 'dsh-config-catalog-local-'))
    roots.push(root)
    const write = fixtureWriter(root)
    write('packages/test/local/package.json', JSON.stringify({ name: '@test/local' }))
    write('packages/test/local/src/config.ts', localConfig)
    return { root, write }
  }

  it('reads as-const and satisfies inject lists and a NodeConfig import from ./config.ts', () => {
    const { root, write } = localRoot()
    write('packages/test/local/src/index.ts', `
import { NodeConfig } from './config.ts'
import type { Config } from './config.ts'
export default class LocalRuntime {
  static inject = (['tools' as const, 'systemPrompt'] as const)
  static Config = NodeConfig
  constructor(ctx: unknown, config: Config) {}
}
`)
    write('packages/test/satisfied/package.json', JSON.stringify({ name: '@test/satisfied' }))
    write('packages/test/satisfied/src/config.ts', localConfig)
    write('packages/test/satisfied/src/index.ts', `
import { NodeConfig } from './nested/../config.ts'
import type { Config } from './config.ts'
export const inject = ['ptcRuntime'] satisfies readonly string[]
export const Config = NodeConfig
export function apply(ctx: unknown, config: Config): void {}
`)
    const entries = collectConfigCatalog(root)
    const local = entries.find(entry => entry.pkg === '@test/local')
    const satisfied = entries.find(entry => entry.pkg === '@test/satisfied')
    expect(local?.inject).toEqual(['tools', 'systemPrompt'])
    expect(local?.schemaKeys).toEqual(['workers'])
    expect(satisfied?.inject).toEqual(['ptcRuntime'])
    expect(satisfied?.schemaKeys).toEqual(['workers'])
  })

  it('rejects an inject alias wrapped in as const', () => {
    const { root, write } = localRoot()
    write('packages/test/local/src/index.ts', `
import { NodeConfig } from './config.ts'
import type { Config } from './config.ts'
const services = ['tools']
export const inject = services as const
export const Config = NodeConfig
export function apply(ctx: unknown, config: Config): void {}
`)
    expect(() => collectConfigCatalog(root)).toThrow('inject is not a plain string-array literal')
  })

  it('rejects a schema key absent from the package-local config type', () => {
    const { root, write } = localRoot()
    write('packages/test/local/src/config.ts', localConfig.replace(
      'workers: Schema.number()',
      'workers: Schema.number(), hidden: Schema.string()',
    ))
    write('packages/test/local/src/index.ts', `
import { NodeConfig } from './config.ts'
import type { Config } from './config.ts'
export const inject = ['tools']
export const Config = NodeConfig
export function apply(ctx: unknown, config: Config): void {}
`)
    expect(() => collectConfigCatalog(root)).toThrow("schema validates key 'hidden' but config type 'Config' declares no such member")
  })

  it('rejects a type-only package-local schema import', () => {
    const { root, write } = localRoot()
    write('packages/test/local/src/index.ts', `
import type { NodeConfig } from './config.ts'
import type { Config } from './config.ts'
export const Config = NodeConfig
export function apply(ctx: unknown, config: Config): void {}
`)
    expect(() => collectConfigCatalog(root)).toThrow("schema alias 'NodeConfig' must name a const or named value import")
  })

  it('rejects an extensionless, declaration, missing, escaping, or unknown schema reference', () => {
    const cases = [
      ['import { NodeConfig } from \'./config\'', "schema import './config' is not a package-local TypeScript source file"],
      ['import { NodeConfig } from \'./config.d.ts\'', "schema import './config.d.ts' is not a package-local TypeScript source file"],
      ['import { NodeConfig } from \'./missing.ts\'', "schema import './missing.ts' has no package-local source file"],
      ['import { NodeConfig } from \'../escaped.ts\'', 'must resolve inside packages/test/local/src'],
      ['import { NodeConfig } from \'@missing/pkg\'', "schema import '@missing/pkg' is not a workspace package"],
    ] as const
    for (const [importLine, message] of cases) {
      const { root, write } = localRoot()
      write('packages/test/local/src/index.ts', `
${importLine}
import type { Config } from './config.ts'
export const Config = NodeConfig
export function apply(ctx: unknown, config: Config): void {}
`)
      expect(() => collectConfigCatalog(root), importLine).toThrow(message)
    }
  })

  it('rejects a package-local schema that is not an exported const or a static call', () => {
    const { root, write } = localRoot()
    write('packages/test/local/src/config.ts', localConfig.replace('export const NodeConfig', 'const NodeConfig'))
    write('packages/test/local/src/index.ts', `
import { NodeConfig } from './config.ts'
import type { Config } from './config.ts'
export const Config = NodeConfig
export function apply(ctx: unknown, config: Config): void {}
`)
    expect(() => collectConfigCatalog(root)).toThrow("has no exported const 'NodeConfig'")

    const dynamic = localRoot()
    dynamic.write('packages/test/local/src/config.ts', `
import Schema from '@deepseek-ai/schemastery'
export interface Config { /** Worker limit. */ workers: number }
export const NodeConfig = makeSchema()
`)
    dynamic.write('packages/test/local/src/index.ts', `
import { NodeConfig } from './config.ts'
import type { Config } from './config.ts'
export const Config = NodeConfig
export function apply(ctx: unknown, config: Config): void {}
`)
    expect(() => collectConfigCatalog(dynamic.root)).toThrow('not a statically walkable schemastery call')
  })
})

describe('config catalog rendering', () => {
  const entries = (inject: string[]): CatalogEntry[] => [
    {
      pkg: '@deepseek-ai/dsh-demo',
      dir: 'packages/demo/demo',
      entry: 'packages/demo/demo/src/index.ts',
      kind: 'config',
      inject,
      pastes: [{ text: 'export interface DemoConfig {}', source: 'packages/demo/demo/src/index.ts:3' }],
    },
    { pkg: '@deepseek-ai/dsh-plain', dir: 'packages/demo/plain', entry: 'packages/demo/plain/src/index.ts', kind: 'no-config', inject },
  ]
  const paths = translationPairPaths('docs/config-catalog.md')
  const record = (inject: string[]) => computeTranslationPairingRecord(
    paths,
    render(entries(inject), 'en'),
    render(entries(inject), 'zh'),
    { repoRoot: process.cwd(), isTranslationPairSource: () => false },
  )

  it('keeps package data in generated regions shared by both languages', () => {
    const en = generatedRegions(render(entries(['jobs']), 'en')).map(region => region.text)
    expect(en.map(region => region.split('\n')[0])).toEqual([
      '<!-- BEGIN GENERATED config-catalog:@deepseek-ai/dsh-demo -->',
      '<!-- BEGIN GENERATED config-catalog:no-config -->',
      '<!-- BEGIN GENERATED config-catalog:seam -->',
      '<!-- BEGIN GENERATED config-catalog:library -->',
    ])
    expect(generatedRegions(render(entries(['jobs']), 'zh')).map(region => region.text)).toEqual(en)
    expect(en[0]).toContain('- `inject`: `jobs`')
  })

  it('leaves the consistency record unchanged when only package data changes', () => {
    expect(record(['jobs', 'typert'])).toEqual(record(['jobs']))
    expect([...record(['jobs']).keys()].some(key => key.includes('dsh-demo'))).toBe(false)
  })
})
