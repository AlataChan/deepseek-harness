import { EventEmitter } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { createTuiCommandRouter } from '../src/driver/commands.ts'
import type { createTuiController } from '../src/driver/controller.ts'
import type { createTuiInputDriver } from '../src/driver/input.ts'
import type { createTuiShutdown } from '../src/driver/shutdown.ts'
import type { createTuiProcess } from '../src/process.ts'
import type { startTuiRender } from '../src/render/start.tsx'
import type { projectToolCard } from '../src/render/tool-model.ts'
import { createInitialState } from '../src/state/reducer.ts'
import { createTuiStore } from '../src/state/store.ts'

const mocks = vi.hoisted(() => ({
  createController: vi.fn<typeof createTuiController>(),
  createRouter: vi.fn<typeof createTuiCommandRouter>(),
  createInput: vi.fn<typeof createTuiInputDriver>(),
  createShutdown: vi.fn<typeof createTuiShutdown>(),
  createProcess: vi.fn<typeof createTuiProcess>(),
  startRender: vi.fn<typeof startTuiRender>(),
  projectTool: vi.fn<typeof projectToolCard>(),
}))

vi.mock('../src/driver/controller.ts', () => ({ createTuiController: mocks.createController }))
vi.mock('../src/driver/commands.ts', () => ({ createTuiCommandRouter: mocks.createRouter }))
vi.mock('../src/driver/input.ts', () => ({ createTuiInputDriver: mocks.createInput }))
vi.mock('../src/driver/shutdown.ts', () => ({ createTuiShutdown: mocks.createShutdown }))
vi.mock('../src/process.ts', () => ({ createTuiProcess: mocks.createProcess }))
vi.mock('../src/render/start.tsx', () => ({ startTuiRender: mocks.startRender }))
vi.mock('../src/render/tool-model.ts', () => ({ projectToolCard: mocks.projectTool }))

import { apply, launchTuiRuntime, type Config } from '../src/index.ts'

function required<T>(value: T | undefined, subject: string): T {
  if (value === undefined) throw new Error(`missing ${subject}`)
  return value
}

function runtimeBench() {
  const stdout = new EventEmitter() as EventEmitter & { write: ReturnType<typeof vi.fn> }
  stdout.write = vi.fn(() => true)
  const stderr = new EventEmitter() as EventEmitter & { write: ReturnType<typeof vi.fn> }
  stderr.write = vi.fn(() => true)
  const stdin = new EventEmitter()
  const process = {
    stdin, stdout, stderr,
    stdinIsTTY: true, stdoutIsTTY: true, columns: 80, rows: 24, cwd: '/workspace',
    requestExit: vi.fn(), restoreInput: vi.fn(),
    onResize: vi.fn((listener: () => void) => { stdout.on('resize', listener); return () => stdout.off('resize', listener) }),
    onExit: vi.fn((listener: () => void) => { stdin.on('end', listener); return () => stdin.off('end', listener) }),
  }
  const store = createTuiStore(createInitialState({ columns: 80 }))
  let agent: { id: string; status: 'idle' | 'running' } | undefined = {
    id: SessionId('runtime-agent'), status: 'idle',
  }
  const controller = {
    get agent() { return agent },
    modelSelection: undefined,
    transcript: { rows: [] },
    selectorRows: [{ sessionId: SessionId('saved'), title: 'Saved', createdAt: 1 }],
    selectionCancelled: false,
    store,
    approval: {}, questions: {},
    selectSession: vi.fn(async () => {}), cancelSelection: vi.fn(), submit: vi.fn(),
    openResumeSelector: vi.fn(async () => {}), cancelActive: vi.fn(), settleInteractions: vi.fn(),
    whenIdle: vi.fn(async () => {}), flush: vi.fn(async () => {}), dispose: vi.fn(async () => {}),
  }
  const input = { handle: vi.fn(async () => {}), reject: vi.fn() }
  const router = { route: vi.fn(async () => 'accepted' as const) }
  const view = { unmount: vi.fn(), waitUntilExit: vi.fn(async () => {}) }
  const shutdown = { shutdown: vi.fn(async () => {}) }
  mocks.createController.mockResolvedValue(controller as never)
  mocks.createInput.mockReturnValue(input)
  mocks.createRouter.mockReturnValue(router)
  mocks.startRender.mockReturnValue(view as never)
  mocks.createShutdown.mockReturnValue(shutdown)
  mocks.createProcess.mockReturnValue(process as never)
  return {
    process, controller, input, router, view, shutdown,
    setAgent(value: typeof agent) { agent = value },
  }
}

function validConfig(): Config {
  return {
    terminalColumnsFallback: 80,
    resumeTranscriptRows: 200,
    sessionSelectorLimit: 50,
    toolOutputDisplayBudget: 32_768,
    startup: { kind: 'fresh' },
  }
}

const config = validConfig()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('tui runtime wiring', () => {
  it('connects controller, commands, input, render, resize, tools, and shutdown ownership', async () => {
    const test = runtimeBench()
    const ctx = new Context()
    const mounted = vi.fn()
    const disposed = vi.fn()
    ctx.on('tui/controller-mounted', mounted)
    ctx.on('tui/controller-disposed', disposed)

    const runtime = await launchTuiRuntime(ctx, config, test.process as never)
    expect(runtime.controller).toBe(test.controller)
    expect(mounted).toHaveBeenCalledOnce()

    const routerOptions = required(mocks.createRouter.mock.calls.at(0), 'router call')[1]
    expect(routerOptions.agent()).toBe(test.controller.agent)
    routerOptions.submitModel('hello')
    await routerOptions.openResume()
    await routerOptions.requestShutdown()
    expect(test.controller.submit).toHaveBeenCalledWith('hello')

    const inputOptions = required(mocks.createInput.mock.calls.at(0), 'input call')[0]
    await inputOptions.route('/help', new AbortController().signal)
    inputOptions.cancelTurn()
    await inputOptions.requestShutdown()
    await inputOptions.openResume()
    const selectResume = required(inputOptions.selectResume, 'resume selector')
    await selectResume('1')
    await selectResume('saved')
    await expect(selectResume('9')).rejects.toThrow(/does not exist/)
    required(inputOptions.cancelResume, 'resume cancellation')()
    expect(inputOptions.isTurnActive()).toBe(false)
    test.controller.agent!.status = 'running'
    expect(inputOptions.isTurnActive()).toBe(true)

    const renderCall = required(mocks.startRender.mock.calls.at(0), 'render call')
    const renderOptions = required(renderCall[2], 'render options')
    expect(required(renderOptions.getResumeRows, 'resume rows')()).toBe(test.controller.selectorRows)
    const toolRow = { kind: 'tool-call', sourceSeq: 1, callId: 'call', name: 'bash', arguments: '{}' }
    const projectTool = required(renderOptions.projectTool, 'tool projector')
    projectTool(toolRow as never)
    expect(mocks.projectTool).toHaveBeenCalled()
    test.setAgent(undefined)
    expect(() => projectTool(toolRow as never)).toThrow(/no owned Agent/)

    const runtimeStore = required(mocks.createController.mock.calls.at(0), 'controller call')[1].store
    test.process.stdout.emit('resize')
    expect(runtimeStore.getSnapshot().dimensions).toEqual({ columns: 80, rows: 24 })
    Object.assign(test.process, { columns: 90, rows: undefined })
    test.process.stdout.emit('resize')
    expect(runtimeStore.getSnapshot().dimensions).toEqual({ columns: 90, rows: undefined })
    test.process.stdin.emit('end')

    const shutdownOptions = required(mocks.createShutdown.mock.calls.at(0), 'shutdown call')[0]
    shutdownOptions.rejectInput()
    await shutdownOptions.settleInteractions()
    shutdownOptions.cancelAgent()
    await shutdownOptions.whenIdle()
    await shutdownOptions.flushSession()
    await shutdownOptions.unmount()
    shutdownOptions.restoreRawMode()
    await shutdownOptions.disposeOwned()
    shutdownOptions.requestExit(7)
    expect(disposed).toHaveBeenCalledOnce()
    expect(test.process.requestExit).toHaveBeenCalledWith(7)
    await ctx.fiber.dispose()

    const noRows = runtimeBench()
    Object.assign(noRows.process, { rows: undefined })
    const noRowsCtx = new Context()
    const noRowsRuntime = await launchTuiRuntime(noRowsCtx, config, noRows.process as never)
    expect(required(mocks.createController.mock.calls.at(-1), 'last controller call')[1]
      .store.getSnapshot().dimensions.rows).toBeUndefined()
    const noRowsShutdown = required(mocks.createShutdown.mock.calls.at(-1), 'last shutdown call')[0]
    noRowsShutdown.rejectInput()
    await noRowsRuntime.controller.dispose()
    await noRowsCtx.fiber.dispose()
  })

  it('rejects every missing validated value before mounting', async () => {
    const test = runtimeBench()
    const ctx = new Context()
    const withoutStartup = validConfig()
    delete withoutStartup.startup
    await expect(launchTuiRuntime(ctx, withoutStartup, test.process as never))
      .rejects.toThrow(/startup config/)
    const withoutBudget = validConfig()
    delete withoutBudget.toolOutputDisplayBudget
    await expect(launchTuiRuntime(ctx, withoutBudget, test.process as never))
      .rejects.toThrow(/toolOutputDisplayBudget/)
    const withoutSelectorLimit = validConfig()
    delete withoutSelectorLimit.sessionSelectorLimit
    await expect(launchTuiRuntime(ctx, withoutSelectorLimit, test.process as never))
      .rejects.toThrow(/sessionSelectorLimit/)
    const withoutResumeLimit = validConfig()
    delete withoutResumeLimit.resumeTranscriptRows
    await expect(launchTuiRuntime(ctx, withoutResumeLimit, test.process as never))
      .rejects.toThrow(/resumeTranscriptRows/)
    await ctx.fiber.dispose()
  })

  it('mounts through apply, reports launch failure, and disposes successful ownership', async () => {
    const missing = new Context()
    expect(() => { apply(missing, config) }).toThrow(/must provide ctx.appExit/)
    await missing.fiber.dispose()

    const failed = runtimeBench()
    const failedCtx = new Context()
    const exit = vi.fn()
    failedCtx.provide('appExit', exit)
    mocks.createController.mockRejectedValueOnce(new Error('startup failed'))
    apply(failedCtx, config)
    await new Promise((resolve) => { setImmediate(resolve) })
    expect(failed.process.stderr.write).toHaveBeenCalledWith('dsh: startup failed\n')
    expect(failed.process.restoreInput).toHaveBeenCalled()
    expect(failed.process.requestExit).toHaveBeenCalledWith(1)
    await failedCtx.fiber.dispose()

    const stringFailed = runtimeBench()
    const stringCtx = new Context()
    stringCtx.provide('appExit', vi.fn())
    mocks.createController.mockRejectedValueOnce('string startup failure')
    apply(stringCtx, config)
    await new Promise((resolve) => { setImmediate(resolve) })
    expect(stringFailed.process.stderr.write).toHaveBeenCalledWith('dsh: string startup failure\n')
    await stringCtx.fiber.dispose()

    const success = runtimeBench()
    const successCtx = new Context()
    successCtx.provide('appExit', vi.fn())
    apply(successCtx, config)
    await new Promise((resolve) => { setImmediate(resolve) })
    await successCtx.fiber.dispose()
    expect(success.shutdown.shutdown).toHaveBeenCalledWith('owner')
  })
})
