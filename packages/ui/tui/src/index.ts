/** In-process terminal presentation plugin. @module @deepseek-ai/dsh-tui */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import z from '@deepseek-ai/schemastery'
import { createTuiCommandRouter } from './driver/commands.ts'
import { createTuiController, type TuiController, type TuiControllerStartup } from './driver/controller.ts'
import { createTuiInputDriver } from './driver/input.ts'
import { createTuiShutdown, type TuiShutdown } from './driver/shutdown.ts'
import { createTuiProcess, type TuiProcess } from './process.ts'
import { startTuiRender } from './render/start.tsx'
import { projectToolCard } from './render/tool-model.ts'
import { createInitialState } from './state/reducer.ts'
import { createTuiStore } from './state/store.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

/** Cordis plugin name. */
export const name = 'tui'

/** Services required before the terminal controller can start. */
export const inject = [
  'agentDefaultModel',
  'agents',
  'approval',
  'commands',
  'sessionQuery',
  'sessions',
  'tools',
  'userQuestions',
]

/** Validated terminal presentation limits and startup intent. */
export interface Config {
  /** Width used when stdout exposes no positive integer column count. */
  terminalColumnsFallback?: number
  /** Maximum finalized transcript rows restored into terminal scrollback. */
  resumeTranscriptRows?: number
  /** Maximum sessions offered by the resume selector. */
  sessionSelectorLimit?: number
  /** Maximum bytes retained for one rendered tool output. */
  toolOutputDisplayBudget?: number
  /** Startup value injected by the TUI application bundle. */
  startup?: TuiControllerStartup
}

const StartupConfig: z<TuiControllerStartup> = z.union([
  z.object({ kind: z.const('fresh').required(), task: z.string() }),
  z.object({ kind: z.const('resume-picker').required() }),
  z.object({ kind: z.const('resume').required(), sessionId: z.string().required() }),
]) as z<TuiControllerStartup>

/** Terminal presentation configuration. */
export const Config: z<Config> = z.object({
  terminalColumnsFallback: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(80),
  resumeTranscriptRows: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(200),
  sessionSelectorLimit: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(50),
  toolOutputDisplayBudget: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(32_768),
  startup: StartupConfig,
})

/** One live lifecycle relation observed by the package invariant. */
export interface TuiControllerLifecycle {
  readonly controller: TuiController
  readonly agent: TuiController['agent']
  readonly providersPublished: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A TUI controller and its interaction providers became live.
     * @mode emit
     * @param lifecycle - exact published relation.
     */
    'tui/controller-mounted'(lifecycle: TuiControllerLifecycle): void
    /**
     * The same TUI-owned relation completed disposal.
     * @mode emit
     * @param lifecycle - exact disposed relation.
     */
    'tui/controller-disposed'(lifecycle: TuiControllerLifecycle): void
  }
}

/** Live runtime returned to the Cordis owner and deterministic acceptance tests. */
export interface TuiRuntime {
  readonly controller: TuiController
  readonly process: TuiProcess
  readonly shutdown: TuiShutdown
}

function requiredNumber(value: number | undefined, name: string): number {
  if (value === undefined) throw new Error(`tui: validated ${name} is missing`)
  return value
}

/**
 * Launch one fully composed TUI over an explicit process adapter.
 * @param ctx - settled application context.
 * @param config - validated startup and display configuration.
 * @param process - explicit terminal process adapter.
 * @returns the live controller and its shutdown capability.
 */
export async function launchTuiRuntime(
  ctx: Context,
  config: Config,
  process: TuiProcess,
): Promise<TuiRuntime> {
  if (config.startup === undefined) throw new Error('tui: startup config is required')
  const displayBudget = {
    maxBytes: requiredNumber(config.toolOutputDisplayBudget, 'toolOutputDisplayBudget'),
    maxColumns: requiredNumber(config.toolOutputDisplayBudget, 'toolOutputDisplayBudget'),
  }
  const store = createTuiStore(createInitialState({
    columns: process.columns,
    ...(process.rows === undefined ? {} : { rows: process.rows }),
  }))
  const controller = await createTuiController(ctx, {
    startup: config.startup,
    cwd: process.cwd,
    displayBudget,
    sessionSelectorLimit: requiredNumber(config.sessionSelectorLimit, 'sessionSelectorLimit'),
    resumeTranscriptRows: requiredNumber(config.resumeTranscriptRows, 'resumeTranscriptRows'),
    store,
  })
  const router = createTuiCommandRouter(ctx, {
    agent: () => controller.agent,
    store,
    submitModel: (line) => { controller.submit(line) },
    openResume: () => controller.openResumeSelector(),
    requestShutdown: () => shutdown.shutdown('user'),
  })
  const input = createTuiInputDriver({
    store,
    route: (line, signal) => router.route(line, signal),
    cancelTurn: () => { controller.cancelActive() },
    requestShutdown: () => shutdown.shutdown('user'),
    openResume: () => controller.openResumeSelector(),
    selectResume: async (value) => {
      const rows = controller.selectorRows
      const numeric = /^\d+$/u.test(value) ? Number(value) : undefined
      const selected = numeric === undefined ? SessionId(value) : rows[numeric - 1]?.sessionId
      if (selected === undefined) throw new Error('tui: resume selection does not exist')
      await controller.selectSession(selected)
    },
    cancelResume: () => { controller.cancelSelection() },
    isTurnActive: () => controller.agent?.status === 'running',
    approval: controller.approval,
    questions: controller.questions,
  })
  const view = startTuiRender(store, process, {
    resumeRows: controller.selectorRows,
    getResumeRows: () => controller.selectorRows,
    input,
    projectTool: (row) => {
      const agent = controller.agent
      if (agent === undefined) throw new Error('tui: tool row has no owned Agent')
      return projectToolCard(ctx, agent, row, displayBudget)
    },
  })
  const stopResize = process.onResize(() => {
    store.dispatch({
      type: 'terminal/resize', columns: process.columns,
      ...(process.rows === undefined ? {} : { rows: process.rows }),
    })
  })
  const relation: TuiControllerLifecycle = {
    controller, agent: controller.agent, providersPublished: true,
  }
  const shutdown = createTuiShutdown({
    rejectInput: () => { input.reject(); stopExit(); stopResize() },
    settleInteractions: () => { controller.settleInteractions() },
    cancelAgent: () => { controller.cancelActive() },
    whenIdle: () => controller.whenIdle(),
    flushSession: () => controller.flush(),
    unmount: async () => { view.unmount(); await view.waitUntilExit() },
    restoreRawMode: () => { process.restoreInput() },
    disposeOwned: async () => {
      await controller.dispose()
      ctx.emit('tui/controller-disposed', relation)
    },
    requestExit: (code) => { process.requestExit(code) },
  })
  const stopExit = process.onExit(() => { void shutdown.shutdown('user') })
  ctx.emit('tui/controller-mounted', relation)
  return { controller, process, shutdown }
}

/**
 * Mount the terminal presentation package.
 * @param ctx - Cordis context that owns the terminal client lifecycle.
 * @param config - validated presentation and startup values.
 */
export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('tui: the launcher must provide ctx.appExit before the tree mounts')
  const process = createTuiProcess(
    requiredNumber(config.terminalColumnsFallback, 'terminalColumnsFallback'),
    exit,
  )
  const runtime = launchTuiRuntime(ctx, config, process)
  void runtime.catch((error: unknown) => {
    process.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
    process.restoreInput()
    process.requestExit(1)
  })
  ctx.effect(() => async () => {
    try {
      await (await runtime).shutdown.shutdown('owner')
    } catch {
      // Launch or cleanup already reported through the launcher-facing failure path.
    }
  }, 'tui.runtime()')
}
