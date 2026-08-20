/**
 * @deepseek-ai/dsh-vscode-app — VS Code surface runtime context plus the
 * bundle patch declared by this package's `dsh.bundle.patch` manifest field.
 * @module @deepseek-ai/dsh-vscode-app
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { addHarnessSourceSection } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Stable Cordis plugin name. */
export const name = 'vscode-app'

/** This installation's root from either the source or built entry. */
const SOURCE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

/** VS Code runtime configuration derived from the startup provider. */
export interface Config {
  /** Absolute workspace root selected by the extension. */
  workspaceRoot: string
  /** Whether to register model-visible VS Code surface orientation. */
  surfaceContext: boolean
}

/** Validated VS Code runtime configuration. */
export const Config: z<Config> = z.object({
  workspaceRoot: z.string().required(),
  surfaceContext: z.boolean().default(true),
})

/** Model-visible orientation for sessions created through the editor surface. */
function vscodeSurfacePrompt(workspaceRoot: string): string {
  return `You are interacting with the user through a DeepSeek Harness panel in Visual Studio Code for workspace ${workspaceRoot}. `
    + 'When the user refers to "this editor", "this workspace", or "this extension" without naming another target, they mean that VS Code surface and workspace. '
    + 'The surface provides no implicit editor selection, open-document contents, diagnostics, or unsaved text; use only editor context explicitly attached to the conversation. '
    + 'Open requested workspace files in the existing editor through the available Host action instead of starting another GUI or server.'
}

/**
 * Register the VS Code and Harness-source prompt sections.
 * @param ctx - plugin context that may later receive the system-prompt service.
 * @param config - selected workspace and surface-context switch.
 */
export function apply(ctx: Context, config: Config): void {
  if (!config.surfaceContext) return
  ctx.inject(['systemPrompt'], (promptCtx) => {
    addHarnessSourceSection(promptCtx, SOURCE_ROOT)
    promptCtx.systemPrompt.section({
      name: 'app:vscode-surface',
      order: -98,
      text: vscodeSurfacePrompt(config.workspaceRoot),
    })
  })
}
