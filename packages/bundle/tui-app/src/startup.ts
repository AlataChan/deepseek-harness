/** TUI-owned command-line parsing and startup publication. @module @deepseek-ai/dsh-tui-app/startup */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import { SessionId } from '@deepseek-ai/dsh-session'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'
/** Service required before app arguments can be parsed. */
export const inject = ['cmdlineArgs']
/** Service read by the terminal client row. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** Startup mode selected by the TUI-owned command line. */
export type TuiStartupValues =
  | { kind: 'fresh'; task?: string }
  | { kind: 'resume-picker' }
  | { kind: 'resume'; sessionId: SessionId }

interface TuiOptions {
  resume?: true | string
}

/** Create one fresh Commander tree and publish its resolved startup value. */
function tuiCommand(publish: (values: TuiStartupValues) => void): Command {
  const program = new Command()
    .name('dsh')
    .description('Start or resume an interactive DeepSeek Harness terminal session.')
    .helpOption('-h, --help', 'show this help')
    .option('--resume [session-id]', 'choose a session to resume, or resume the exact id')
    .argument('[task...]', 'optional initial task; multiple words are joined by spaces')
    .addHelpText('after', `
Examples:
  dsh "write the tests"       start a fresh session and submit one task
  dsh --resume                choose a persisted session
  dsh --resume <session-id>   resume one persisted session
`)

  program.action((taskWords: string[], options: TuiOptions) => {
    const task = taskWords.join(' ')
    if (options.resume !== undefined && task !== '') {
      program.error('error: --resume and an initial task are mutually exclusive')
    }
    if (options.resume === true) {
      publish({ kind: 'resume-picker' })
    } else if (typeof options.resume === 'string') {
      publish({ kind: 'resume', sessionId: SessionId(options.resume) })
    } else {
      publish(task === '' ? { kind: 'fresh' } : { kind: 'fresh', task })
    }
  })
  return program
}

/**
 * Parse TUI app arguments without reading global process state.
 * @param argv - arguments passed through by the launcher.
 * @returns the selected fresh or resume startup value.
 */
export function parseTuiStartupArgs(argv: readonly string[]): TuiStartupValues {
  let resolved: TuiStartupValues | undefined
  const program = tuiCommand((values) => { resolved = values })
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} })
  program.parse([...argv], { from: 'user' })
  /* v8 ignore next -- a successful parse runs the command action */
  if (resolved === undefined) throw new Error('tui-startup: no startup value resolved')
  return resolved
}

/**
 * Parse and publish the TUI startup mode as an ordinary Cordis service.
 * @param ctx - plugin context carrying the launcher-provided arguments.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand((values) => { ctx.provide(TUI_STARTUP_SERVICE, values) })
  parseCmdline(ctx, program)
}
