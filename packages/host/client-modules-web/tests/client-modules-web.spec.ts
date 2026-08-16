/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts the Web server and client-module Web adapter, then
 * observes bundle serving, manifest injection, and effect-scoped teardown.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type {
  ClientBootGraph, ClientBundleRecord, ClientModuleRegistry,
} from '@deepseek-ai/dsh-client-modules'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as modulesClient from '@deepseek-ai/dsh-client-modules/client'
import type {
  ClientModuleLoaderTarget,
} from '@deepseek-ai/dsh-client-modules/client'
import * as ClientModulesWeb from '../src/index.ts'

const MODULES_ID = '@deepseek-ai/dsh-client-modules'
const RUNTIME_ID = '@deepseek-ai/dsh-client-runtime'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-client-modules-web-'))
  const bundlePath = join(root, 'bundle', 'client.js')
  await mkdir(join(root, 'bundle'))
  await writeFile(bundlePath, 'module.exports = { marker: "client" }\n')
  await writeFile(`${bundlePath}.map`, '{"version":3}\n')

  const graph: ClientBootGraph = {
    rev: 'graph-rev',
    entries: [{
      id: '@fixture/client',
      url: '/plugins/@fixture/client/client.js?rev=bundle-rev',
      rev: 'bundle-rev',
      inject: ['</script>'],
    }],
  }
  const bundles: readonly ClientBundleRecord[] = [{ entry: graph.entries[0]!, clientPath: bundlePath }]

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    '- id: client-modules-web',
    "  name: '@deepseek-ai/dsh-host-client-modules-web'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  context.provide('clientModules', {
    graph: () => graph,
    bundleRecords: () => bundles,
  } as ClientModuleRegistry)
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', WebServer],
    ['@deepseek-ai/dsh-host-client-modules-web', ClientModulesWeb],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  const unloaded = [...context.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
  expect(unloaded).toEqual([])
  return context
}

async function request(port: number, path: string, init?: RequestInit): Promise<{ status: number; type: string | null; body: string }> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, init)
  return { status: response.status, type: response.headers.get('content-type'), body: await response.text() }
}

/** Execute the exact first inline script emitted by the Web HTML transform. */
function injectedFacade(graph: ClientBootGraph): { html: string; target: ClientModuleLoaderTarget } {
  const html = ClientModulesWeb.injectBootManifest(
    '<html><head></head><body><script type="module" src="/index.js"></script></body></html>',
    graph,
  )
  const source = /<head><script>([\s\S]*?)<\/script>/.exec(html)?.[1]
  if (source === undefined) throw new Error('missing injected ModuleLoader facade script')
  const window: { __ModuleLoader__?: ClientModuleLoaderTarget } = {}
  runInNewContext(source, { window })
  if (window.__ModuleLoader__ === undefined) throw new Error('facade script did not install __ModuleLoader__')
  return { html, target: window.__ModuleLoader__ }
}

const bootGraph = (): ClientBootGraph => ({
  rev: 'graph',
  entries: [
    { id: MODULES_ID, url: '/plugins/modules.js?rev=m&next=<ready>', rev: 'm' },
    { id: RUNTIME_ID, url: '/plugins/runtime.js?rev=r', rev: 'r' },
  ],
})

describe('HTML bootstrap facade', () => {
  it('precedes escaped blocking preloads and the boot graph, then becomes the live registration target', async () => {
    const graph = bootGraph()
    const { html, target } = injectedFacade(graph)
    const facadeAt = html.indexOf('window.__ModuleLoader__=')
    const modulesAt = html.indexOf('<script src="/plugins/modules.js?rev=m&amp;next=&lt;ready&gt;"></script>')
    const runtimeAt = html.indexOf('<script src="/plugins/runtime.js?rev=r"></script>')
    const graphAt = html.indexOf('window.__DSH_BOOT__ = ')
    const entryAt = html.indexOf('<script type="module" src="/index.js"></script>')
    expect([facadeAt, modulesAt, runtimeAt, graphAt, entryAt]).toEqual([...new Set([
      facadeAt, modulesAt, runtimeAt, graphAt, entryAt,
    ])].sort((a, b) => a - b))

    target.load({ id: MODULES_ID, factory: () => modulesClient })
    target.load({ id: RUNTIME_ID, factory: () => ({ marker: 'runtime' }) })
    const system = target.create({ boot: graph, staticModules: {} })

    expect(target.mode).toBe('live')
    expect(target.pendingQueue).toEqual([])
    expect(system.manifest.rev).toBe('graph')
    expect(await system.import(MODULES_ID)).toBe(modulesClient)
    expect(await system.import(`${RUNTIME_ID}/client`)).toEqual({ marker: 'runtime' })
    expect(() => target.create({ boot: graph, staticModules: {} }))
      .toThrow('create called after module-system boot')
  })

  it('rejects a page that did not preload the modules bundle', () => {
    const graph = bootGraph()
    const { target } = injectedFacade(graph)
    expect(() => target.create({ boot: graph, staticModules: {} }))
      .toThrow(`HTML did not preload ${MODULES_ID}/client.js`)
  })

  it('rejects a bootstrap bundle with a runtime external', () => {
    const graph = bootGraph()
    const { target } = injectedFacade(graph)
    target.load({
      id: MODULES_ID,
      factory: (require) => {
        require('react')
        return modulesClient
      },
    })
    expect(() => target.create({ boot: graph, staticModules: {} }))
      .toThrow(`${MODULES_ID}/client.js requested external "react"`)
  })

  it.each([
    null,
    { ...modulesClient, createClientModuleSystem: undefined },
    { ...modulesClient, apply: undefined },
  ])('rejects a bootstrap bundle without the complete module face', (exports) => {
    const graph = bootGraph()
    const { target } = injectedFacade(graph)
    target.load({ id: MODULES_ID, factory: () => exports as unknown as Record<string, unknown> })
    expect(() => target.create({ boot: graph, staticModules: {} }))
      .toThrow(`${MODULES_ID}/client.js did not export the bootstrap module face`)
  })
})

describe('real Loader composition', () => {
  it('serves client bundles, injects the graph, and releases both registrations', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const server = loaded.webServer

    expect(await request(server.port, '/plugins/@fixture/client/client.js')).toMatchObject({
      status: 200,
      type: 'text/javascript; charset=utf-8',
      body: 'module.exports = { marker: "client" }\n',
    })
    expect(await request(server.port, '/plugins/@fixture/client/client.js.map')).toMatchObject({
      status: 200,
      type: 'application/json; charset=utf-8',
      body: '{"version":3}\n',
    })
    expect((await request(server.port, '/plugins/@fixture/client/client.js', { method: 'HEAD' })).status).toBe(200)
    expect((await request(server.port, '/plugins/@fixture/missing/client.js')).status).toBe(404)
    expect((await request(server.port, '/plugins/@fixture/client/not-client.js')).status).toBe(404)
    expect((await request(server.port, '/plugins')).status).toBe(404)
    expect((await request(server.port, '/plugins/@fixture/client/client.js', { method: 'POST' })).status).toBe(405)
    const withHead = server.applyIndexTaps('<html><head></head></html>')
    expect(withHead).toContain(
      '<script>window.__DSH_BOOT__ = {"rev":"graph-rev"',
    )
    expect(withHead).toContain('"inject":["\\u003c/script>"]')
    const withoutHead = server.applyIndexTaps('<body>fixture</body>')
    expect(withoutHead).toMatch(/^<script>/)
    expect(withoutHead.indexOf('window.__ModuleLoader__='))
      .toBeLessThan(withoutHead.indexOf('window.__DSH_BOOT__ ='))

    await rm(join(root!, 'bundle', 'client.js'))
    expect((await request(server.port, '/plugins/@fixture/client/client.js')).status).toBe(404)

    const adapter = [...loaded.loader.entries()].find(entry => entry.options.id === 'client-modules-web')
    expect(adapter).toBeDefined()
    await adapter!.fiber?.dispose()
    expect(server.applyIndexTaps('<html><head></head></html>')).toBe('<html><head></head></html>')
    const release = server.register({
      kind: 'prefix',
      path: '/plugins',
      handler: (_req, res) => { res.writeHead(204); res.end() },
    })
    release()
  })
})
