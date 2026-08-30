/**
 * @deepseek-ai/dsh-desktop-app — desktop surface runtime context plus the
 * bundle patch declared by this package's `dsh.bundle.patch` manifest field.
 * @module @deepseek-ai/dsh-desktop-app
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { addHarnessSourceSection } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Stable Cordis plugin name. */
export const name = 'desktop-app'

/** This installation's root from either the source or built entry. */
const SOURCE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

/** Desktop runtime configuration derived from the startup provider. */
export interface Config {
  /** Absolute workspace root selected by the desktop shell. */
  workspaceRoot: string
  /** Whether to register model-visible desktop surface orientation. */
  surfaceContext: boolean
}

/** Validated desktop runtime configuration. */
export const Config: z<Config> = z.object({
  workspaceRoot: z.string().required(),
  surfaceContext: z.boolean().default(true),
})

/** Model-visible orientation for sessions created through the desktop application. */
function desktopSurfacePrompt(workspaceRoot: string): string {
  return `You are interacting with the user through the DeepSeek Harness desktop application for workspace ${workspaceRoot}. `
    + 'When the user refers to "this app", "this window", or "this workspace" without naming another target, they mean that desktop application and workspace. '
    + 'Open requested workspace files through the Host platform opener instead of starting another GUI or server.'
}

export { parseDesktopStartupArgs, type DesktopStartupValues } from './startup.ts'

/**
 * Register the desktop and Harness-source prompt sections.
 * @param ctx - plugin context that may later receive the system-prompt service.
 * @param config - selected workspace and surface-context switch.
 */
export function apply(ctx: Context, config: Config): void {
  if (!config.surfaceContext) return
  ctx.inject(['systemPrompt'], (promptCtx) => {
    addHarnessSourceSection(promptCtx, SOURCE_ROOT)
    promptCtx.systemPrompt.section({
      name: 'app:desktop-surface',
      order: -98,
      text: desktopSurfacePrompt(config.workspaceRoot),
    })
  })
}
