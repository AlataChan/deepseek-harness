// @vitest-environment jsdom
/** VS Code Webview bootstrap against the current Client module-loader protocol. */

import type {
  ClientBootGraph, ClientBundleRegistration, ClientModuleLoaderTarget, DshWindow,
} from '@deepseek-ai/dsh-client-modules/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installBootGraph,
  installWebviewModuleLoader,
  preloadWebviewBootstrap,
  readWebviewBoot,
} from '../src/webview/vscode-port.ts'

const MODULES_ID = '@deepseek-ai/dsh-client-modules'
const RUNTIME_ID = '@deepseek-ai/dsh-client-runtime'
const win = globalThis as DshWindow

afterEach(() => {
  delete win.__DSH_BOOT__
  delete win.__ModuleLoader__
  document.head.innerHTML = ''
  vi.restoreAllMocks()
})

function graph(): ClientBootGraph {
  return {
    rev: 'graph',
    entries: [
      { id: MODULES_ID, url: 'vscode-resource:modules.js', rev: 'modules' },
      {
        id: RUNTIME_ID,
        url: 'vscode-resource:runtime.js',
        rev: 'runtime',
        external: ['@deepseek-ai/dsh-client-ui-renderer/client'],
      },
    ],
  }
}

describe('Webview boot metadata', () => {
  it('accepts the current graph fields and installs the graph verbatim', () => {
    const boot = { graph: graph(), locale: 'en', maxLogicalRpcBytes: 1024 }
    const meta = document.createElement('meta')
    meta.name = 'dsh-vscode-boot'
    meta.content = btoa(JSON.stringify(boot))
    document.head.append(meta)

    expect(readWebviewBoot(document)).toEqual(boot)
    installBootGraph(boot.graph)
    expect(win.__DSH_BOOT__).toBe(boot.graph)
  })
})

describe('Webview module bootstrap', () => {
  it('queues the modules and runtime factories before the shell creates the module system', async () => {
    const target = installWebviewModuleLoader()
    const created = { version: 'client' as const }
    const createClientModuleSystem = vi.fn(() => {
      target.mode = 'live'
      return created as never
    })
    const registrations = new Map<string, ClientBundleRegistration>([
      ['vscode-resource:modules.js', {
        id: MODULES_ID,
        factory: () => ({ apply: vi.fn(), createClientModuleSystem }),
      }],
      ['vscode-resource:runtime.js', {
        id: RUNTIME_ID,
        factory: () => ({ apply: vi.fn() }),
      }],
    ])
    const loaded: string[] = []

    await preloadWebviewBootstrap(graph(), async (url) => {
      loaded.push(url)
      const registration = registrations.get(url)
      if (registration === undefined) throw new Error(`missing registration ${url}`)
      target.load(registration)
    })

    expect(loaded).toEqual(['vscode-resource:modules.js', 'vscode-resource:runtime.js'])
    expect(target.pendingQueue.map(registration => registration.id)).toEqual([MODULES_ID, RUNTIME_ID])
    const options = { boot: graph(), staticModules: {} }
    expect(target.create(options)).toBe(created)
    expect(createClientModuleSystem).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ id: MODULES_ID }),
      options,
    )
  })

  it('fails before shell boot when a required bootstrap row is absent', async () => {
    installWebviewModuleLoader()
    await expect(preloadWebviewBootstrap({
      rev: 'missing-runtime',
      entries: [{ id: MODULES_ID, url: 'modules.js', rev: 'modules' }],
    }, vi.fn())).rejects.toThrow(`boot graph is missing ${RUNTIME_ID}`)
  })

  it('rejects creating the module system without the modules factory', () => {
    const target: ClientModuleLoaderTarget = installWebviewModuleLoader()
    expect(() => target.create({ boot: graph(), staticModules: {} }))
      .toThrow(`did not preload ${MODULES_ID}/client.js`)
  })
})
