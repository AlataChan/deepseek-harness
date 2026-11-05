/** Preset boundary: standard stays free of MCP and computer-use; this preset owns one row. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { composePresetPlugins, desktopMcpLaunch, installDesktopOperationPreset, readComposition, readPresetMetadata, supervisorProgram } from '../src/preset.ts'

const accessFault = vi.hoisted(() => ({ error: undefined as undefined | Error | string | { code: number } }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    async access(...args: Parameters<typeof actual.access>) {
      if (accessFault.error !== undefined) {
        const error = accessFault.error
        accessFault.error = undefined
        throw error
      }
      return actual.access(...args)
    },
  }
})

const repo = new URL('../../../../', import.meta.url)
const compositionUrl = new URL('../preset/desktop-operation/agent.cordis.yml', import.meta.url)

describe('desktop-operation preset boundary', () => {
  it('leaves standard without an MCP or computer-use row', async () => {
    const standard = await readFile(new URL('packages/bundle/web-app/presets/standard.patch.yml', repo), 'utf8')
    expect(standard).not.toContain('dsh-mcp-client')
    expect(standard).not.toContain('computer-use')
    const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch).toContain("name: '@deepseek-ai/dsh-experimental-desktop-operation'")
    expect(patch).not.toContain('mcp-client')
  })

  it('keeps MCP off the shared preset and builds one launch per Agent', async () => {
    const text = await readFile(compositionUrl, 'utf8')
    expect(text).toContain("dshHomePath('.agent-presets', 'desktop-operation', 'skills')")
    const rows = readComposition(text)
    const input = {
      platform: 'darwin' as const,
      arch: 'arm64',
      home: '/tmp/agent-desktop',
      lockPath: '/tmp/agent-desktop.lock',
      binary: '/opt/agent-desktop',
      helper: '/opt/agent-desktop-macos-helper',
      supervisor: '/opt/supervisor.js',
      node: '/usr/local/bin/node',
    }
    const supported = composePresetPlugins(rows)
    expect(supported.some(row => row.name === '@deepseek-ai/dsh-mcp-client')).toBe(false)
    const launch = desktopMcpLaunch(input, rows)
    if (launch === undefined) throw new Error('missing desktop launch')
    expect(launch.command).toBe('/usr/local/bin/node')
    expect(launch.args).toEqual(['/opt/supervisor.js', '--lock', '/tmp/agent-desktop.lock', '--binary', '/opt/agent-desktop', '--', 'mcp'])
    expect(launch.env).toEqual({
      AGENT_DESKTOP_HOME: '/tmp/agent-desktop',
      AGENT_DESKTOP_MACOS_HELPER_PATH: '/opt/agent-desktop-macos-helper',
    })
    expect(launch.failOnStartupError).toBe(true)
    expect(launch.reconnect).toEqual({ enabled: false })
    expect(launch.toolCallTimeoutMs).toBe(60000)
    expect(desktopMcpLaunch(input, [{
      name: '@deepseek-ai/dsh-mcp-client',
      config: { toolCallTimeoutMs: 15000 },
    }])?.toolCallTimeoutMs).toBe(15000)
    expect(JSON.stringify(launch)).not.toContain('headed')
    expect(desktopMcpLaunch({ ...input, platform: 'linux' }, rows)).toBeUndefined()
    expect(composePresetPlugins(rows).some(row => row.name === '@deepseek-ai/dsh-mcp-client')).toBe(false)
  })

  it('omits a missing timeout and ignores a timeout that is not a number', () => {
    const input = {
      platform: 'darwin' as const, arch: 'arm64', home: '/tmp', lockPath: '/tmp/lock',
      binary: '/bin', helper: '/helper', supervisor: '/supervisor.js', node: '/node',
    }
    expect(composePresetPlugins([])).toEqual([])
    expect(desktopMcpLaunch(input, [])).not.toHaveProperty('toolCallTimeoutMs')
    expect(desktopMcpLaunch(input, [{
      name: '@deepseek-ai/dsh-mcp-client',
      config: { toolCallTimeoutMs: 'slow' },
    }])).not.toHaveProperty('toolCallTimeoutMs')
    expect(desktopMcpLaunch(input, [{
      name: '@deepseek-ai/dsh-mcp-client',
      config: [],
    }])).not.toHaveProperty('toolCallTimeoutMs')
    expect(desktopMcpLaunch(input, [{
      name: '@deepseek-ai/dsh-mcp-client',
      config: { cwd: '' },
    }])).not.toHaveProperty('toolCallTimeoutMs')
    const nested = composePresetPlugins([{
      name: 'group',
      config: [{ name: 'child' }],
    }])
    expect(nested.some(row => row.name === '@deepseek-ai/dsh-mcp-client')).toBe(false)
  })

  it('keeps an installed preset, copies a missing one, and refuses a path under a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ad01-preset-'))
    const target = join(dir, 'desktop-operation')
    await installDesktopOperationPreset(import.meta.url, target)
    await writeFile(join(target, 'marker'), 'keep')
    await installDesktopOperationPreset(import.meta.url, target)
    expect(await readFile(join(target, 'marker'), 'utf8')).toBe('keep')
    const blocker = join(dir, 'blocker')
    await writeFile(blocker, 'not a directory')
    await expect(installDesktopOperationPreset(import.meta.url, join(blocker, 'preset'))).rejects.toThrow()
    await rm(dir, { recursive: true, force: true })
  })

  it('reads partial metadata and rejects a composition that is not a list', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ad01-meta-'))
    const file = join(dir, 'preset.yml')
    await writeFile(file, 'null\n')
    expect(await readPresetMetadata(file)).toEqual({})
    await writeFile(file, 'name: 1\ndescription: []\norder: late\n')
    expect(await readPresetMetadata(file)).toEqual({})
    await writeFile(file, 'name: 桌面\norder: 7\n')
    expect(await readPresetMetadata(file)).toEqual({ name: '桌面', order: 7 })
    expect(() => readComposition('{}\n')).toThrow('desktop-operation: preset composition must be a list')
    expect(() => readComposition('42\n')).toThrow('desktop-operation: preset composition must be a list')
    expect(() => readComposition('- {}\n')).toThrow(/names no plugin/)
    await rm(dir, { recursive: true, force: true })
  })

  it('uses the built supervisor when supervisor.js is present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ad01-program-'))
    const built = join(dir, 'supervisor.js')
    await writeFile(built, '')
    const moduleUrl = pathToFileURL(join(dir, 'index.ts')).href
    expect(supervisorProgram(moduleUrl)).toBe(built)
    await rm(built)
    expect(supervisorProgram(moduleUrl)).toBe(join(dir, 'supervisor.ts'))
    await rm(dir, { recursive: true, force: true })
  })

  it('refuses a computer-use row', () => {
    expect(() => composePresetPlugins([{ name: '@deepseek-ai/dsh-computer-use' }])).toThrow(/computer-use/)
    expect(() => composePresetPlugins([{
      name: 'group',
      config: [{ name: '@deepseek-ai/dsh-computer-use' }],
    }])).toThrow(/computer-use/)
  })

  it('keeps a row that has no config and refuses an access error that is not ENOENT', async () => {
    const plain = composePresetPlugins([{ name: 'plain' }, { name: 'group', config: [{ name: 'child' }] }])
    const nested = readComposition('- name: group\n  config:\n    - name: 1\n    - null\n    - skip\n    - { label: hidden }\n')
    expect(composePresetPlugins(nested).some(row => row.name === 'group')).toBe(true)
    expect(plain.some(row => row.name === 'plain')).toBe(true)
    expect(plain.some(row => row.name === '@deepseek-ai/dsh-mcp-client')).toBe(false)
    const dir = await mkdtemp(join(tmpdir(), 'ad01-access-'))
    accessFault.error = new TypeError('not a path')
    await expect(installDesktopOperationPreset(import.meta.url, join(dir, 'preset'))).rejects.toBeInstanceOf(TypeError)
    accessFault.error = { code: 1 }
    await expect(installDesktopOperationPreset(import.meta.url, join(dir, 'preset'))).rejects.toEqual({ code: 1 })
    accessFault.error = 'not-an-error'
    await expect(installDesktopOperationPreset(import.meta.url, join(dir, 'preset'))).rejects.toBe('not-an-error')
    await rm(dir, { recursive: true, force: true })
  })
})
