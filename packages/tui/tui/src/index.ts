/**
 * Interactive Terminal User Interface (TUI) Cordis plugin entry.
 * Function plugin with no default export, adhering to harness plugin conventions.
 *
 * @module @deepseek-ai/dsh-tui
 */

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-query'
import type { TuiStatus } from './types.ts'
import type { TuiConfig } from './types.ts'
import { Config, resolveTuiConfig } from './config.ts'
import { getLocale } from './locales.ts'
import {
  enterAlternateScreen,
  restoreTerminalNow,
  TerminalRenderer,
} from './render.ts'
import { InputController } from './input.ts'
import { SessionAdapter, runWithTimeout } from './session.ts'
import { InteractionProvider } from './interaction.ts'

export * from './types.ts'
export * from './config.ts'
export * from './locales.ts'
export * from './render.ts'
export * from './input.ts'
export * from './session.ts'
export * from './interaction.ts'

export const name = 'tui'
export const inject = ['agents']

export { Config, resolveTuiConfig }

/**
 * Apply the interactive TUI plugin to the Cordis context.
 * @param ctx - Cordis Context.
 * @param config - Plugin configuration options.
 */
export function apply(ctx: Context, config: TuiConfig = {}): void {
  const resolved = resolveTuiConfig(config)
  const dict = getLocale(resolved.locale)

  // Reject non-interactive execution before entering raw mode
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(`${dict.errorTtyRequired}\n`)
    ctx.appExit?.(1)
    return
  }

  const admissionState = { stopped: false }

  // Register synchronous terminal restore hook with launcher FIRST before mode changes
  const unregisterRestore = ctx.get('terminalRestore')?.register(() => {
    admissionState.stopped = true
    try {
      input.stop()
    } catch {
      // Contained
    }
    restoreTerminalNow(process.stdout, process.stdin)
  })

  // Enter alternate screen and record original terminal raw state
  enterAlternateScreen(process.stdout, process.stdin)

  const renderer = new TerminalRenderer(
    resolved.maxScrollbackLines,
    process.stdout,
    {
      maxScrollbackLineLength: resolved.maxScrollbackLineLength,
      dict,
    },
  )
  let activeStatus: TuiStatus = 'idle'
  let activeModel = 'default'
  let activeSessionId = ''
  let interactionPromptText: string | undefined
  let currentStreamingText: string | undefined
  let lastRenderTime = 0
  let renderTimer: NodeJS.Timeout | undefined

  const renderCurrentState = (streaming?: string): void => {
    if (admissionState.stopped) return
    if (streaming !== undefined) {
      currentStreamingText = streaming.length > 0 ? streaming : undefined
      const now = Date.now()
      // Throttle streaming renders to at most once per redrawIntervalMs
      if (streaming.length > 0 && now - lastRenderTime < resolved.redrawIntervalMs) {
        if (!renderTimer) {
          renderTimer = setTimeout(() => {
            renderTimer = undefined
            renderCurrentState()
          }, resolved.redrawIntervalMs - (now - lastRenderTime))
        }
        return
      }
    }
    if (renderTimer) {
      clearTimeout(renderTimer)
      renderTimer = undefined
    }
    lastRenderTime = Date.now()
    renderer.render(
      {
        sessionId: activeSessionId,
        workspace: process.cwd(),
        model: activeModel,
        status: activeStatus,
        draft: input.getDraft(),
        cursorGraphemeIndex: input.getCursorIndex(),
        interactionPrompt: interactionPromptText,
        streamingText: currentStreamingText,
      },
      dict,
    )
  }

  // Resize listener
  const onResize = (): void => {
    renderCurrentState()
  }
  process.stdout.on('resize', onResize)

  const interaction = new InteractionProvider(
    ctx,
    renderer,
    {
      onInteractionStart: (prompt) => {
        interactionPromptText = prompt
        renderCurrentState()
      },
      onInteractionEnd: () => {
        interactionPromptText = undefined
        renderCurrentState()
      },
      getActiveAgent: () => session.agent,
    },
    dict,
  )

  const session = new SessionAdapter(
    ctx,
    renderer,
    {
      onStatusChange: (status) => {
        activeStatus = status
        renderCurrentState()
      },
      onModelChange: (model) => {
        activeModel = model
        renderCurrentState()
      },
      onSessionChange: (id) => {
        activeSessionId = id
        renderCurrentState()
      },
      onRenderRequest: (streaming) => {
        renderCurrentState(streaming)
      },
    },
    dict,
    {
      maxStreamAccumulatorChars: resolved.maxStreamAccumulatorChars,
    },
  )

  const input = new InputController(
    process.stdin,
    {
      onSubmit: (text) => {
        if (admissionState.stopped) return
        if (interaction.hasActiveInteraction) {
          interaction.handleInput(text)
          renderCurrentState()
        } else {
          void session.submitPrompt(text)
        }
      },
      onCancel: () => {
        if (admissionState.stopped) return
        if (interaction.hasActiveInteraction) {
          interaction.cancelPending()
        } else {
          session.cancelActiveTurn()
        }
      },
      onExit: () => {
        ctx.appExit?.(0)
      },
      onRender: () => {
        renderCurrentState()
      },
    },
    {
      maxInputBytes: resolved.maxInputBytes,
      maxPasteBytes: resolved.maxPasteBytes,
      maxHistoryEntries: resolved.maxHistoryEntries,
    },
  )

  const startupPromise = (async (): Promise<void> => {
    try {
      await ctx.get('loader')?.await()
      if (admissionState.stopped) return
      await session.initDefaultSession()
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Mutated externally during async await
      if (!admissionState.stopped) {
        input.start()
        renderCurrentState()
      }
    } catch {
      // Contained
    }
  })()

  // Effect-managed teardown: restores terminal before fallible async cleanup, joins startup and bounds disposers
  ctx.effect(
    () => async () => {
      admissionState.stopped = true
      process.stdout.removeListener('resize', onResize)
      input.stop()
      interaction.cancelPending()

      if (renderTimer) {
        clearTimeout(renderTimer)
        renderTimer = undefined
      }

      // Restore terminal state synchronously before fallible async cleanup
      restoreTerminalNow(process.stdout, process.stdin)
      unregisterRestore?.()

      const errors: Error[] = []

      // Join active startup transition if still in progress
      try {
        await runWithTimeout(startupPromise, 2500, 'Startup transition timed out during teardown')
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)))
      }

      // Dispose active session with deadline
      try {
        await runWithTimeout(session.dispose(), 2500, 'Session disposal timed out during teardown')
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)))
      }

      if (errors.length > 0) {
        throw new AggregateError(errors, `TUI teardown encountered errors: ${errors.map(e => e.message).join('; ')}`)
      }
    },
    'tui: lifecycle',
  )
}
