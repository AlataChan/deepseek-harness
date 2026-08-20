/**
 * VS Code companion startup argument provider. The extension passes exactly
 * one selected absolute workspace root; ordinary rows inject the resulting
 * service before reading it from lazy config.
 * @module @deepseek-ai/dsh-vscode-app/startup
 */

import { isAbsolute, resolve } from 'node:path'
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'vscode-startup'

/** Service required before the startup arguments can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided to VS Code runtime and carrier rows. */
export const VSCODE_STARTUP_SERVICE = 'vscodeStartup'

/** Immutable facts selected by the extension for one companion process. */
export interface VsCodeStartupValues {
  /** Absolute root of the VS Code workspace served by this companion. */
  workspaceRoot: string
}

/** The VS Code flag family as Commander parsed it. */
interface VsCodeOptions {
  workspaceRoot: string
}

/** Build the one owned grammar with a caller-selected success sink. */
function vscodeCommand(publish: (values: VsCodeStartupValues) => void): Command {
  const program = new Command()
    .name('dsh --profile vscode')
    .description('Start the DeepSeek Harness companion for a VS Code workspace.')
    .helpOption('-h, --help', 'show this help')
    .requiredOption('--workspace-root <path>', 'absolute selected workspace root')
    .allowExcessArguments(false)
  program.action(() => {
    const workspaceRoot = program.opts<VsCodeOptions>().workspaceRoot
    if (!isAbsolute(workspaceRoot)) {
      program.error(`error: --workspace-root must be absolute, got ${JSON.stringify(workspaceRoot)}`)
    }
    publish(Object.freeze({ workspaceRoot: resolve(workspaceRoot) }))
  })
  return program
}

/**
 * Parse the exact companion argument grammar without writing to process IO.
 * @param args - arguments after the companion module path.
 * @returns the validated workspace facts.
 * @throws a Commander usage error for missing, relative, extra, or unknown input.
 */
export function parseVsCodeStartupArgs(args: readonly string[]): VsCodeStartupValues {
  let parsed: VsCodeStartupValues | undefined
  const program = vscodeCommand((values) => { parsed = values })
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} })
  program.parse([...args], { from: 'user' })
  /* v8 ignore next 2 -- the sole successful command action publishes synchronously; help and usage errors throw. */
  if (parsed === undefined) throw new Error('vscode companion arguments did not select a workspace root')
  return parsed
}

/**
 * Parse and publish the VS Code invocation as an ordinary Cordis service.
 * @param ctx - plugin context carrying the immutable launcher arguments.
 */
export function apply(ctx: Context): void {
  const program = vscodeCommand((values) => { ctx.provide(VSCODE_STARTUP_SERVICE, values) })
  parseCmdline(ctx, program)
}
