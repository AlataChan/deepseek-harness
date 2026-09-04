/** @vitest-environment jsdom */

import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VSCODE_CARRIER_PROTOCOL_VERSION } from '@deepseek-ai/dsh-client-connection-process/protocol'
import type { ClientTransportHooks } from '@deepseek-ai/dsh-client-connection/client'
import {
  bootDesktopClient,
  resetDesktopBootstrapForTests,
} from '../src/bootstrap.ts'
import type { DesktopDownlinkEvent, DesktopShellPort } from '../src/harness-port.ts'

const MODULES = '@deepseek-ai/dsh-client-modules'
const SIDEBAR = '@deepseek-ai/dsh-client-ui-sidebar'

afterEach(() => {
  resetDesktopBootstrapForTests()
  document.body.replaceChildren()
  document.head.replaceChildren()
})

function sha256(bytes: string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function readyFrame(overrides: {
  protocolVersion?: number
  runtimeVersion?: string
  sha256?: string
} = {}) {
  const source = 'export {}\n'
  return {
    type: 'control/ready' as const,
    protocolVersion: overrides.protocolVersion ?? VSCODE_CARRIER_PROTOCOL_VERSION,
    runtimeVersion: overrides.runtimeVersion ?? '0.0.1-test',
    maxLogicalRpcBytes: 4096,
    graph: {
      rev: 'graph-1',
      entries: [
        { id: MODULES, url: 'pending', rev: '1' },
        { id: SIDEBAR, url: 'pending', rev: '1' },
      ],
      batches: [
        { phase: 'bootstrap' as const, url: 'pending-modules', rev: '1', entries: [MODULES] },
        { phase: 'application' as const, url: 'pending-sidebar', rev: '1', entries: [SIDEBAR] },
      ],
    },
    bundles: [
      { id: MODULES, rev: '1', sourcePath: '/tmp/modules.js', sha256: overrides.sha256 ?? sha256(source) },
      { id: SIDEBAR, rev: '1', sourcePath: '/tmp/sidebar.js', sha256: sha256(source) },
    ],
  }
}

function createMockPort(options: {
  config?: { workspaceRoot?: string }
  resolveError?: string
  ready?: ReturnType<typeof readyFrame>
  cacheError?: string
}): {
  port: DesktopShellPort
  commands: Array<{ cmd: string; args?: Record<string, unknown> }>
  emit: (event: DesktopDownlinkEvent) => void
} {
  const commands: Array<{ cmd: string; args?: Record<string, unknown> }> = []
  let onEvent: ((event: DesktopDownlinkEvent) => void) | undefined
  const ready = options.ready ?? readyFrame()
  const port: DesktopShellPort = {
    async invoke(cmd, args) {
      commands.push(args === undefined ? { cmd } : { cmd, args })
      if (cmd === 'runtime_get_config') {
        return options.config === undefined
          ? { workspaceRoot: '/tmp/project' }
          : { ...options.config }
      }
      if (cmd === 'runtime_resolve') {
        if (options.resolveError !== undefined) throw new Error(options.resolveError)
        return {
          nodePath: '/usr/bin/node',
          packageRoot: '/tmp/pkg',
          companionEntry: '/tmp/companion.js',
          runtimeVersion: '0.0.1-test',
          discoveryPath: '/usr/bin/node',
        }
      }
      if (cmd === 'carrier_open') {
        queueMicrotask(() => {
          onEvent?.({
            event: 'record',
            data: { line: JSON.stringify({ type: 'wire/message', encoded: JSON.stringify(ready) }) },
          })
        })
        return { generationId: 'gen-1', runtimeVersion: '0.0.1-test', workspaceRoot: '/tmp/project' }
      }
      if (cmd === 'cache_bundle') {
        if (options.cacheError !== undefined) throw new Error(options.cacheError)
        const id = typeof args?.id === 'string' ? args.id : 'bundle'
        return {
          src: `asset://localhost/cache/${id}.js`,
          destination: `/cache/${id}.js`,
          generationDir: '/cache/gen',
          allowed: ['/cache/gen'],
        }
      }
      if (cmd === 'carrier_send') return undefined
      throw new Error(`unexpected command ${cmd}`)
    },
    createChannel(listener) {
      onEvent = listener
      return { kind: 'mock-downlink' }
    },
  }
  return {
    port,
    commands,
    emit(event) { onEvent?.(event) },
  }
}

describe('bootDesktopClient', () => {
  it('passes a downlink Channel into carrier_open and sends control/hello as the first uplink', async () => {
    const { port, commands } = createMockPort({})
    const root = document.createElement('div')
    const loaded: string[] = []
    await bootDesktopClient({
      port,
      root,
      extensionVersion: '0.1.2-rc.1',
      loadBundle: async (url) => { loaded.push(url) },
      createAppEntry: () => ({ run: async () => {} }),
    })
    const open = commands.find(command => command.cmd === 'carrier_open')
    expect(open?.args?.downlink).toEqual({ kind: 'mock-downlink' })
    const firstSend = commands.find(command => command.cmd === 'carrier_send')
    expect(firstSend).toBeDefined()
    const physical = JSON.parse(String(firstSend?.args?.line)) as { type: string; encoded: string }
    expect(physical.type).toBe('wire/message')
    expect(JSON.parse(physical.encoded)).toMatchObject({
      type: 'control/hello',
      protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION,
      extensionVersion: '0.1.2-rc.1',
      workspaceRoot: '/tmp/project',
    })
    expect(loaded).toEqual([
      'asset://localhost/cache/@deepseek-ai/dsh-client-modules.js',
    ])
    expect(root.querySelector('[data-testid="desktop-home"]')).toBeNull()
    expect(root.querySelector('[data-testid="desktop-settings-open"]')).not.toBeNull()
  })

  it('does not construct the app entry before control/ready', async () => {
    const constructed: string[] = []
    const { port } = createMockPort({})
    const root = document.createElement('div')
    await bootDesktopClient({
      port,
      root,
      extensionVersion: 'test',
      loadBundle: async () => { constructed.push('preload') },
      createAppEntry: () => {
        constructed.push('app')
        return { run: async () => {} }
      },
    })
    expect(constructed.indexOf('preload')).toBeLessThan(constructed.indexOf('app'))
    expect(constructed[0]).toBe('preload')
  })

  it('calls cache_bundle once per announced location and refuses a hash mismatch', async () => {
    const ok = createMockPort({})
    const root = document.createElement('div')
    await bootDesktopClient({
      port: ok.port,
      root,
      extensionVersion: 'test',
      loadBundle: async () => {},
      createAppEntry: () => ({ run: async () => {} }),
    })
    expect(ok.commands.filter(command => command.cmd === 'cache_bundle')).toHaveLength(2)
    resetDesktopBootstrapForTests()
    const failing = createMockPort({ cacheError: 'bundle hash mismatch' })
    const failingRoot = document.createElement('div')
    const failed = await bootDesktopClient({
      port: failing.port,
      root: failingRoot,
      extensionVersion: 'test',
      loadBundle: async () => {},
      createAppEntry: () => ({ run: async () => {} }),
    })
    expect(failed).toEqual({
      status: 'home',
      reason: expect.stringMatching(/hash mismatch/),
    })
    expect(failingRoot.querySelector('[data-testid="desktop-home"]')).not.toBeNull()
  })

  it('installs __DSH_TRANSPORT__ before constructing the app entry', async () => {
    const { port } = createMockPort({})
    const root = document.createElement('div')
    let hooks: ClientTransportHooks | undefined
    await bootDesktopClient({
      port,
      root,
      extensionVersion: 'test',
      loadBundle: async () => {},
      createAppEntry: () => ({
        run() {
          hooks = (globalThis as { __DSH_TRANSPORT__?: ClientTransportHooks }).__DSH_TRANSPORT__
          return Promise.resolve()
        },
      }),
    })
    expect(hooks?.ownsHost).toBe(true)
    expect(typeof hooks?.fetch).toBe('function')
    expect(typeof hooks?.openStream).toBe('function')
  })

  it('executes the module-system and runtime rows before constructing the app entry', async () => {
    const { port } = createMockPort({})
    const order: string[] = []
    await bootDesktopClient({
      port,
      root: document.createElement('div'),
      extensionVersion: 'test',
      loadBundle: async (url) => { order.push(url) },
      createAppEntry: () => {
        order.push('app-entry')
        return { run: async () => {} }
      },
    })
    expect(order).toEqual([
      'asset://localhost/cache/@deepseek-ai/dsh-client-modules.js',
      'app-entry',
    ])
  })

  it('opens the home page when runtime_get_config fails', async () => {
    const port: DesktopShellPort = {
      async invoke(cmd) {
        if (cmd === 'runtime_get_config') throw new Error('runtime config is unreadable')
        throw new Error(`unexpected command ${cmd}`)
      },
      createChannel: () => ({}),
    }
    const root = document.createElement('div')
    const result = await bootDesktopClient({
      port,
      root,
      extensionVersion: 'test',
    })
    expect(result).toEqual({ status: 'home', reason: 'runtime config is unreadable' })
    expect(root.querySelector('[data-testid="desktop-home"]')).not.toBeNull()
  })

  it('opens the home page when runtime_resolve fails', async () => {
    const { port } = createMockPort({ resolveError: 'Node executable was not found' })
    const root = document.createElement('div')
    const result = await bootDesktopClient({
      port,
      root,
      extensionVersion: 'test',
    })
    expect(result).toEqual({ status: 'home', reason: 'Node executable was not found' })
    expect(root.querySelector('[data-testid="desktop-home"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="desktop-settings"]')).toBeNull()
    expect(root.querySelector('[data-testid="desktop-home-status"]')?.textContent)
      .toBe('没有找到 Node.js。')
  })

  it('keeps the home page when workspaceRoot is still empty', async () => {
    const { port } = createMockPort({ config: {} })
    const root = document.createElement('div')
    const result = await bootDesktopClient({
      port,
      root,
      extensionVersion: 'test',
    })
    expect(result).toEqual({ status: 'home', reason: 'workspaceRoot is not configured' })
    expect(root.querySelector('[data-testid="desktop-home"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="desktop-settings"]')).toBeNull()
  })

  it('opens the settings panel from home only after the user asks', async () => {
    const { port } = createMockPort({ resolveError: 'Node executable was not found' })
    const root = document.createElement('div')
    await bootDesktopClient({
      port,
      root,
      extensionVersion: 'test',
    })
    root.querySelector<HTMLButtonElement>('[data-testid="desktop-settings-open"]')?.click()
    expect(root.querySelector('[data-testid="desktop-home"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="desktop-settings"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="desktop-settings-reason"]')?.textContent)
      .toBe('没有找到 Node.js。')
    expect(root.querySelector('[data-testid="desktop-settings-advanced"]')).not.toBeNull()
    expect(root.querySelector('input[name="workspaceRoot"]')).not.toBeNull()
  })

  it('opens settings when New session still cannot resolve', async () => {
    const { port } = createMockPort({ resolveError: 'Node executable was not found' })
    const root = document.createElement('div')
    await bootDesktopClient({
      port,
      root,
      extensionVersion: 'test',
    })
    root.querySelector<HTMLButtonElement>('[data-testid="desktop-home-start"]')?.click()
    await vi.waitFor(() => {
      expect(root.querySelector('[data-testid="desktop-settings"]')).not.toBeNull()
    })
    expect(root.querySelector('[data-testid="desktop-home"]')).not.toBeNull()
  })

  it('returns home when the companion does not become ready in time', async () => {
    const port: DesktopShellPort = {
      async invoke(cmd) {
        if (cmd === 'runtime_get_config') return { workspaceRoot: '/tmp/project' }
        if (cmd === 'runtime_resolve') {
          return {
            nodePath: '/usr/bin/node',
            packageRoot: '/tmp/pkg',
            companionEntry: '/tmp/companion.js',
            runtimeVersion: '0.0.1-test',
            discoveryPath: '/usr/bin/node',
          }
        }
        if (cmd === 'carrier_open') {
          return { generationId: 'gen-1', runtimeVersion: '0.0.1-test', workspaceRoot: '/tmp/project' }
        }
        if (cmd === 'carrier_send') return undefined
        throw new Error(`unexpected command ${cmd}`)
      },
      createChannel: () => ({}),
    }
    const result = await bootDesktopClient({
      port,
      root: document.createElement('div'),
      extensionVersion: 'test',
      handshakeTimeoutMs: 20,
    })
    expect(result).toEqual({
      status: 'home',
      reason: expect.stringMatching(/timed out/),
    })
  })

  it('cancels the handshake timeout after control/ready', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const { port } = createMockPort({})
      const result = await bootDesktopClient({
        port,
        root: document.createElement('div'),
        extensionVersion: 'test',
        handshakeTimeoutMs: 15_000,
        loadBundle: async () => {},
        createAppEntry: () => ({ run: async () => {} }),
      })
      expect(result.status).toBe('ready')
      await vi.advanceTimersByTimeAsync(16_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses a second boot in the same document', async () => {
    const { port } = createMockPort({})
    const options = {
      port,
      root: document.createElement('div'),
      extensionVersion: 'test',
      loadBundle: async () => {},
      createAppEntry: () => ({ run: async () => {} }),
    }
    await bootDesktopClient(options)
    await expect(bootDesktopClient(options)).rejects.toThrow(/one-shot/)
  })
})
