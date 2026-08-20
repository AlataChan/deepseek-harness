/** Direct companion launch never executes a shell shim. */

import { EventEmitter } from 'node:events'
import type { ChildProcess, ForkOptions } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { launchIpcChild } from '../src/ipc-child.ts'

class FakeProcess extends EventEmitter {
  connected = true
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  send(_value: unknown, callback: (error: Error | null) => void): boolean {
    callback(null)
    return true
  }
  disconnect(): void { this.connected = false }
  kill(): boolean { return true }
}

describe('VS Code IPC child', () => {
  it('forks the verified JavaScript entry with a real execPath and separated argv', () => {
    const process = new FakeProcess()
    const fork = vi.fn((_module: string, _args: readonly string[], _options: ForkOptions) => process as ChildProcess)
    const child = launchIpcChild({
      nodePath: '/real/node',
      companionEntry: '/runtime/lib/vscode-companion.js',
      packageRoot: '/runtime',
      runtimeVersion: '0.1.0',
      discoveryPath: '/bin/dsh.cmd',
    }, '/workspace with spaces', { fork })
    expect(fork).toHaveBeenCalledWith(
      '/runtime/lib/vscode-companion.js',
      ['--workspace-root', '/workspace with spaces'],
      expect.objectContaining({
        cwd: '/workspace with spaces',
        execPath: '/real/node',
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      }),
    )
    expect(fork.mock.calls[0]?.[2]).not.toHaveProperty('shell')
    child.dispose()
  })
})
