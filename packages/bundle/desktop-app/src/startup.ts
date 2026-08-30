/**
 * Desktop companion startup argument provider. The Tauri shell passes exactly
 * one selected absolute workspace root; ordinary rows inject the resulting
 * service before reading it from lazy config.
 * @module @deepseek-ai/dsh-desktop-app/startup
 */

import { isAbsolute } from 'node:path'
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'desktop-startup'

/** Service required before the startup arguments can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided to desktop runtime and carrier rows. */
export const DESKTOP_STARTUP_SERVICE = 'desktopStartup'

/** Immutable facts selected by the desktop shell for one companion process. */
export interface DesktopStartupValues {
  /** Absolute workspace root served by this companion. */
  workspaceRoot: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Startup value parsed from the desktop companion command line. */
    desktopStartup: DesktopStartupValues
  }
}

/** The desktop flag family as Commander parsed it. */
interface DesktopOptions {
  workspaceRoot: string
}

/** Build the one owned grammar with a caller-selected success sink. */
function desktopCommand(publish: (values: DesktopStartupValues) => void): Command {
  const program = new Command()
    .name('dsh --profile desktop')
    .description('Start the DeepSeek Harness companion for the desktop application.')
    .helpOption('-h, --help', 'show this help')
    .requiredOption('--workspace-root <path>', 'absolute selected workspace root')
    .allowExcessArguments(false)
  program.action(() => {
    const workspaceRoot = program.opts<DesktopOptions>().workspaceRoot
    if (!isAbsolute(workspaceRoot)) {
      program.error(`error: --workspace-root must be absolute, got ${JSON.stringify(workspaceRoot)}`)
    }
    publish(Object.freeze({ workspaceRoot }))
  })
  return program
}

/**
 * Parse the exact companion argument grammar without writing to process IO.
 * @param args - arguments after the companion module path.
 * @returns the validated workspace facts.
 * @throws a Commander usage error for missing, relative, extra, or unknown input.
 */
export function parseDesktopStartupArgs(args: readonly string[]): DesktopStartupValues {
  let parsed: DesktopStartupValues | undefined
  const program = desktopCommand((values) => { parsed = values })
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} })
  program.parse([...args], { from: 'user' })
  /* v8 ignore next 2 -- the sole successful command action publishes synchronously; help and usage errors throw. */
  if (parsed === undefined) throw new Error('desktop companion arguments did not select a workspace root')
  return parsed
}

/** Service name web-app rows inject; keep this string equal to web-startup's provide. */
const WEB_STARTUP_SERVICE = 'webStartup'

/** Loopback web-app startup facts so webserver and web-runtime still resolve. */
function webStartupForDesktop(): {
  openBrowser: boolean
  host: string
  port: number
  trustedHosts: string[]
} {
  return Object.freeze({
    openBrowser: false,
    host: '127.0.0.1',
    port: 0,
    trustedHosts: [] as string[],
  })
}

/**
 * Parse and publish the desktop invocation as an ordinary Cordis service.
 * Also provides `webStartup` so the web-app rows keep resolving after
 * web-startup is disabled.
 * @param ctx - plugin context carrying the immutable launcher arguments.
 */
export function apply(ctx: Context): void {
  const program = desktopCommand((values) => {
    ctx.provide(DESKTOP_STARTUP_SERVICE, values)
    ctx.provide(WEB_STARTUP_SERVICE, webStartupForDesktop())
  })
  parseCmdline(ctx, program)
}
