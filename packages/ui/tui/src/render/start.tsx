/** Ink renderer startup over an explicit terminal process adapter. @module @deepseek-ai/dsh-tui/render/start */

import { render, type Instance } from 'ink'
import type { ResumeRow } from '../driver/resume.ts'
import type { TuiProcess } from '../process.ts'
import type { TuiStore } from '../state/store.ts'
import { TuiApp } from './app.tsx'

/** Optional immutable values supplied by the runtime controller. */
export interface StartTuiRenderOptions {
  readonly resumeRows?: readonly ResumeRow[]
}

/**
 * Mount one inline Ink application on the explicitly supplied streams.
 * @param store - framework-free state owner.
 * @param process - validated interactive terminal adapter.
 * @param options - immutable controller presentation values.
 * @returns the Ink lifecycle instance owned by shutdown coordination.
 */
export function startTuiRender(
  store: TuiStore,
  process: TuiProcess,
  options: StartTuiRenderOptions = {},
): Instance {
  return render(<TuiApp store={store} resumeRows={options.resumeRows ?? []} />, {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    interactive: true,
    alternateScreen: false,
    exitOnCtrlC: false,
    patchConsole: false,
  })
}
