/** Codex answer selection over a real, keyless JSON-RPC child process. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { CodexAppServerWire } from '../src/wire.ts'

const fixture = fileURLToPath(new URL('../../../../snapshots/session/codex-partial-answer/app-server-fixture.mjs', import.meta.url))

it.each([
  ['codex-primary-model', 'PARTIAL_SELECTED'],
  ['codex-secondary-model', 'FINAL_SELECTED'],
])('selects %s output from a real app-server process', async (model, selected) => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-codex-partial-'))
  const child = spawn(process.execPath, [fixture], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  const exited = once(child, 'close')
  const stderr: Buffer[] = []
  child.stderr.on('data', (chunk: Buffer) => { stderr.push(chunk) })
  const wire = new CodexAppServerWire(child.stdout, child.stdin, 'never', model)
  const signal = new AbortController().signal
  try {
    wire.start()
    await wire.initialize(signal)
    await wire.startThread(cwd, signal)
    await expect(wire.runTurn(['Return the scripted answer.'], signal)).resolves.toEqual({
      output: [{ type: 'text', text: selected }], stopReason: 'completed',
    })
    expect(wire.collectOutput()).toEqual([{ type: 'text', text: selected }])
    expect(JSON.parse((await readFile(join(cwd, 'codex-probe.jsonl'), 'utf8')).trim())).toEqual({
      model, ephemeral: true, approvalPolicy: 'never',
    })
  } finally {
    wire.close()
    child.stdin.end()
    try {
      const [code, processSignal] = await exited
      expect(processSignal).toBeNull()
      expect(code).toBe(0)
      expect(Buffer.concat(stderr).toString()).toBe('')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }
})

it.each(['failed', 'cancelled'] as const)('keeps partial text without reporting a %s turn as completed', async (mode) => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-codex-partial-failure-'))
  const child = spawn(process.execPath, [fixture], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  const exited = once(child, 'close')
  const wire = new CodexAppServerWire(child.stdout, child.stdin, 'never', 'codex-primary-model')
  const controller = new AbortController()
  try {
    wire.start()
    await wire.initialize(controller.signal)
    await wire.startThread(cwd, controller.signal)
    const result = wire.runTurn([mode === 'failed' ? 'Fail after partial.' : 'Hold after partial.'], controller.signal)
    const rejected = expect(result).rejects.toThrow(mode === 'failed' ? 'status failed' : 'cancel fixture')
    if (mode === 'cancelled') {
      await vi.waitFor(() => {
        expect(wire.collectOutput()).toEqual([{ type: 'text', text: 'PARTIAL_SELECTED' }])
      })
      controller.abort(new Error('cancel fixture'))
      wire.interrupt()
    }
    await rejected
    expect(wire.collectOutput()).toEqual([{ type: 'text', text: 'PARTIAL_SELECTED' }])
  } finally {
    wire.close()
    child.stdin.end()
    try {
      const [code, processSignal] = await exited
      expect(processSignal).toBeNull()
      expect(code).toBe(0)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }
})
