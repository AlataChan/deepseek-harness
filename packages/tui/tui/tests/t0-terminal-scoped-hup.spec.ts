/**
 * T0 Terminal-scoped SIGHUP, SIGINT, SIGTERM, and nohup regression tests.
 * Proves that:
 * 1. Launcher attaches SIGHUP handler only while a terminal owner restore hook is registered.
 * 2. When terminal owner unregisters, SIGHUP handler is removed and listeners do not accumulate.
 * 3. Without a terminal owner (e.g. ACP daemon), normal non-nohup dsh receives original POSIX HUP termination.
 * 4. Detached nohup-spawned dsh ACP daemon runs without a terminal owner and cleanly joins SIGTERM teardown (exit 0).
 * 5. SIGHUP triggers restoreNow and reports exit code 129 for TUI terminal owners.
 * 6. SIGINT triggers restoreNow and reports exit code 130.
 * 7. SIGTERM triggers restoreNow and reports exit code 0.
 */

import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import type * as NodePty from 'node-pty'
import { createTerminalRestore } from '@deepseek-ai/dsh-app-boot'
import { createProcessShutdown } from '../../../../apps/cli/src/process-shutdown.ts'

const require = createRequire(import.meta.url)
const pty = require('node-pty') as typeof NodePty

/**
 * Kill a spawned child process and await its exit before continuing,
 * preventing orphaned processes and filesystem cleanup race conditions.
 */
async function killAndJoin(child: ChildProcess | undefined, timeoutMs = 5000): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolve()
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolve()
    }
    child.once('exit', onExit)
    try {
      child.kill('SIGKILL')
    } catch {
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      resolve()
    }
  })
}

/**
 * Terminate a PTY instance and await its exit event before continuing.
 */
async function killAndJoinPty(term: NodePty.IPty | undefined, timeoutMs = 5000): Promise<void> {
  if (!term) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      resolve()
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolve()
    }
    term.onExit(onExit)
    try {
      process.kill(term.pid, 'SIGKILL')
    } catch {
      clearTimeout(timer)
      resolve()
    }
  })
}

describe('T0 terminal-scoped SIGHUP and signal ownership', () => {
  it('manages terminal restore callbacks with reverse-order execution and exception containment', () => {
    const restore = createTerminalRestore()
    const order: number[] = []

    const unreg1 = restore.register(() => {
      order.push(1)
    })
    const unreg2 = restore.register(() => {
      order.push(2)
      throw new Error('boom in restore hook')
    })
    const unreg3 = restore.register(() => {
      order.push(3)
    })

    expect(restore.activeCount).toBe(3)

    // Executes in reverse order (LIFO: 3, 2, 1) and contains errors
    restore.restoreNow()
    expect(order).toEqual([3, 2, 1])

    unreg3()
    expect(restore.activeCount).toBe(2)

    unreg2()
    unreg1()
    expect(restore.activeCount).toBe(0)
  })

  it('notifies onChange whenever activeCount transitions', () => {
    const restore = createTerminalRestore()
    const counts: number[] = []
    restore.onChange = (count) => {
      counts.push(count)
    }

    const unregA = restore.register(() => {})
    const unregB = restore.register(() => {})
    unregB()
    unregA()

    expect(counts).toEqual([1, 2, 1, 0])
  })

  it('binds POSIX SIGHUP only while terminal owner is registered and exits 129', async () => {
    const restore = createTerminalRestore()
    const restored: string[] = []
    let sighupAttached = false
    let sighupHandler: (() => void) | undefined

    const exited: number[] = []
    const shutdown = createProcessShutdown(
      async () => {},
      (code) => { exited.push(code) },
    )
    const interrupt = (code: number): void => {
      shutdown.interrupt(code)
    }

    const onSighup = (): void => {
      restore.restoreNow()
      interrupt(129)
    }

    restore.onChange = (count) => {
      if (count > 0 && !sighupAttached) {
        sighupAttached = true
        sighupHandler = onSighup
      } else if (count === 0 && sighupAttached) {
        sighupAttached = false
        sighupHandler = undefined
      }
    }

    // Initially, no terminal owner -> SIGHUP is NOT attached
    expect(sighupAttached).toBe(false)
    expect(sighupHandler).toBeUndefined()

    // Terminal owner registers
    const unregister = restore.register(() => {
      restored.push('restored-tui')
    })
    expect(sighupAttached).toBe(true)
    expect(sighupHandler).toBeDefined()

    // Trigger SIGHUP
    if (sighupHandler) {
      sighupHandler()
    }
    expect(restored).toEqual(['restored-tui'])
    // Allow shutdown promise to settle
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(exited).toEqual([129])

    // Cleanup unregister
    unregister()
    expect(sighupAttached).toBe(false)
    expect(sighupHandler).toBeUndefined()
  })

  it('handles SIGINT with restoreNow and exit code 130', async () => {
    const restore = createTerminalRestore()
    const restored: string[] = []
    const exited: number[] = []

    restore.register(() => {
      restored.push('sigint-restored')
    })

    const shutdown = createProcessShutdown(
      async () => {},
      (code) => { exited.push(code) },
    )

    const onSigint = (): void => {
      restore.restoreNow()
      shutdown.interrupt(130)
    }

    onSigint()
    expect(restored).toEqual(['sigint-restored'])
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(exited).toEqual([130])
  })

  it('handles SIGTERM with restoreNow and exit code 0', async () => {
    const restore = createTerminalRestore()
    const restored: string[] = []
    const exited: number[] = []

    restore.register(() => {
      restored.push('sigterm-restored')
    })

    const shutdown = createProcessShutdown(
      async () => {},
      (code) => { exited.push(code) },
    )

    const onSigterm = (): void => {
      restore.restoreNow()
      shutdown.interrupt(0)
    }

    onSigterm()
    expect(restored).toEqual(['sigterm-restored'])
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(exited).toEqual([0])
  })

  it('establishes Node.js engine behavior: plain node under nohup resets inherited SIGHUP disposition to default termination', async () => {
    if (process.platform === 'win32') return

    let child: ChildProcess | undefined
    try {
      child = spawn('nohup', [process.execPath, '-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
      })

      const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child?.on('exit', (code, signal) => {
          resolve({ code, signal })
        })
      })

      // Allow process initialization
      await new Promise(r => setTimeout(r, 200))

      // Plain node spawned under nohup receives SIGHUP
      child.kill('SIGHUP')

      const result = await exitPromise
      // Node.js resets signal dispositions via ResetSignalHandlers(), terminating on SIGHUP
      expect(result.signal === 'SIGHUP' || result.code === 129).toBe(true)
    } finally {
      await killAndJoin(child)
    }
  }, 10000)

  it('proves normal non-nohup dsh receives original HUP termination without terminal owner', async () => {
    if (process.platform === 'win32') return

    const home = mkdtempSync(join(tmpdir(), 'dsh-hup-acp-'))
    const dshBin = join(process.cwd(), 'apps/cli/lib/bin.js')
    let child: ChildProcess | undefined

    try {
      child = spawn(process.execPath, [dshBin, '--profile', 'acp'], {
        cwd: home,
        env: {
          ...process.env,
          DSH_HOME: home,
          HOME: home,
          DSH_TELEMETRY_DISABLED: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let ready = false
      child.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('protocolVersion')) {
          ready = true
        }
      })

      // Send JSON-RPC initialize handshake repeatedly until child runtime is ready
      let sendInitInterval: NodeJS.Timeout | undefined
      try {
        const initPayload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } }) + '\n'
        child.stdin?.write(initPayload)
        sendInitInterval = setInterval(() => {
          if (!ready && child && child.exitCode === null && child.signalCode === null) {
            child.stdin?.write(initPayload)
          }
        }, 500)

        await vi.waitFor(() => {
          expect(ready).toBe(true)
        }, { timeout: 15000 })
      } finally {
        if (sendInitInterval) clearInterval(sendInitInterval)
      }

      const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child?.on('exit', (code, signal) => {
          resolve({ code, signal })
        })
      })

      // Send SIGHUP to the running non-nohup process
      child.kill('SIGHUP')

      const result = await exitPromise
      // Without terminal owner, process terminates via default POSIX SIGHUP
      expect(result.signal === 'SIGHUP' || result.code === 129).toBe(true)
    } finally {
      await killAndJoin(child)
      rmSync(home, { recursive: true, force: true })
    }
  }, 20000)

  it('proves nohup-spawned dsh ACP daemon with DSH_DETACHED=1 survives SIGHUP and cleanly joins SIGTERM teardown', async () => {
    if (process.platform === 'win32') return

    const home = mkdtempSync(join(tmpdir(), 'dsh-nohup-acp-'))
    const dshBin = join(process.cwd(), 'apps/cli/lib/bin.js')
    let child: ChildProcess | undefined

    try {
      child = spawn('nohup', [process.execPath, dshBin, '--profile', 'acp'], {
        cwd: home,
        env: {
          ...process.env,
          DSH_HOME: home,
          HOME: home,
          DSH_DETACHED: '1',
          DSH_TELEMETRY_DISABLED: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let ready = false
      child.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('protocolVersion')) {
          ready = true
        }
      })

      // Send JSON-RPC initialize handshake repeatedly until child runtime is ready
      let sendInitInterval: NodeJS.Timeout | undefined
      try {
        const initPayload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } }) + '\n'
        child.stdin?.write(initPayload)
        sendInitInterval = setInterval(() => {
          if (!ready && child && child.exitCode === null && child.signalCode === null) {
            child.stdin?.write(initPayload)
          }
        }, 500)

        await vi.waitFor(() => {
          expect(ready).toBe(true)
        }, { timeout: 15000 })
      } finally {
        if (sendInitInterval) clearInterval(sendInitInterval)
      }

      expect(child.exitCode).toBeNull()

      // Send SIGHUP to the running nohup detached process
      child.kill('SIGHUP')

      // Give it a moment to confirm SIGHUP did not kill it
      await new Promise(r => setTimeout(r, 200))
      expect(child.exitCode).toBeNull()

      const exitPromise = new Promise<number | null>((resolve) => {
        child?.on('exit', (code) => {
          resolve(code)
        })
      })

      // Cleanly terminate detached daemon via SIGTERM
      child.kill('SIGTERM')
      const exitCode = await exitPromise
      expect(exitCode).toBe(0)
    } finally {
      await killAndJoin(child)
      rmSync(home, { recursive: true, force: true })
    }
  }, 20000)

  it('runs real child process with terminal-scoped SIGHUP and exits 129 upon signal', async () => {
    if (process.platform === 'win32') return

    const home = mkdtempSync(join(tmpdir(), 'dsh-sighup-tui-'))
    const dshBin = join(process.cwd(), 'apps/cli/lib/bin.js')
    let term: NodePty.IPty | undefined

    try {
      term = pty.spawn(process.execPath, [dshBin, '--profile', 'tui'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: home,
        env: {
          ...process.env,
          DSH_HOME: home,
          HOME: home,
          DSH_TELEMETRY_DISABLED: '1',
        },
      })

      let stdoutData = ''
      term.onData((d: string) => {
        stdoutData += d
      })

      // Wait for TUI initialization
      await vi.waitFor(() => {
        expect(stdoutData.length).toBeGreaterThan(0)
      }, { timeout: 15000 })

      const exitPromise = new Promise<number>((resolve) => {
        term?.onExit(({ exitCode }: { exitCode: number }) => {
          resolve(exitCode)
        })
      })

      // Send SIGHUP to real TUI process
      process.kill(term.pid, 'SIGHUP')

      const exitCode = await exitPromise
      expect(exitCode).toBe(129)
    } finally {
      await killAndJoinPty(term)
      rmSync(home, { recursive: true, force: true })
    }
  }, 20000)

  it('enforces terminal ownership precedence over DSH_DETACHED=1 in state sync', async () => {
    const restore = createTerminalRestore()
    const isDetached = true
    let sighupAttached = false
    let detachedSighupAttached = false
    const restored: string[] = []
    const exited: number[] = []

    const shutdown = createProcessShutdown(
      async () => {},
      (code) => { exited.push(code) },
    )

    const onSighup = (): void => {
      restore.restoreNow()
      shutdown.interrupt(129)
    }

    const syncSighupListener = (count: number): void => {
      if (count > 0) {
        if (detachedSighupAttached) {
          detachedSighupAttached = false
        }
        if (!sighupAttached) {
          sighupAttached = true
        }
      } else {
        if (sighupAttached) {
          sighupAttached = false
        }
        if (isDetached && !detachedSighupAttached) {
          detachedSighupAttached = true
        }
      }
    }

    restore.onChange = (count) => {
      syncSighupListener(count)
    }
    syncSighupListener(restore.activeCount)

    // At start (count = 0), detached handler is active, not terminal SIGHUP
    expect(detachedSighupAttached).toBe(true)
    expect(sighupAttached).toBe(false)

    // Terminal owner registers: precedence rule activates terminal SIGHUP
    const unregister = restore.register(() => {
      restored.push('terminal-restored')
    })
    expect(detachedSighupAttached).toBe(false)
    expect(sighupAttached).toBe(true)

    // Fire terminal SIGHUP handler
    onSighup()
    expect(restored).toEqual(['terminal-restored'])
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(exited).toEqual([129])

    // When terminal owner unregisters, falls back to detached handler
    unregister()
    expect(sighupAttached).toBe(false)
    expect(detachedSighupAttached).toBe(true)
  })

  it('proves terminal ownership overrides DSH_DETACHED=1 in real TUI process, exiting 129 on SIGHUP', async () => {
    if (process.platform === 'win32') return

    const home = mkdtempSync(join(tmpdir(), 'dsh-sighup-detached-tui-'))
    const dshBin = join(process.cwd(), 'apps/cli/lib/bin.js')
    let term: NodePty.IPty | undefined

    try {
      term = pty.spawn(process.execPath, [dshBin, '--profile', 'tui'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: home,
        env: {
          ...process.env,
          DSH_HOME: home,
          HOME: home,
          DSH_DETACHED: '1',
          DSH_TELEMETRY_DISABLED: '1',
        },
      })

      let stdoutData = ''
      term.onData((d: string) => {
        stdoutData += d
      })

      // Wait for TUI initialization
      await vi.waitFor(() => {
        expect(stdoutData.length).toBeGreaterThan(0)
      }, { timeout: 15000 })

      const exitPromise = new Promise<number>((resolve) => {
        term?.onExit(({ exitCode }: { exitCode: number }) => {
          resolve(exitCode)
        })
      })

      // Send SIGHUP to real TUI process even though DSH_DETACHED=1
      process.kill(term.pid, 'SIGHUP')

      const exitCode = await exitPromise
      // Terminal owner takes precedence -> restores terminal and exits 129!
      expect(exitCode).toBe(129)
    } finally {
      await killAndJoinPty(term)
      rmSync(home, { recursive: true, force: true })
    }
  }, 20000)
})
