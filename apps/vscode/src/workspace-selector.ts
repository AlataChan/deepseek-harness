/** Workspace trust and selected-root decisions independent of VS Code UI types. */

/** Initial-root selection inputs. */
export interface InitialWorkspaceOptions {
  /** Current VS Code workspace trust state. */
  trusted: boolean
  /** Absolute roots attached to the current window. */
  folders: readonly string[]
  /** Picker used only when the window contains multiple folders. */
  pick?: (folders: readonly string[]) => Promise<string | undefined>
}

/** Replacement-root confirmation inputs. */
export interface ReplacementWorkspaceOptions {
  /** Currently selected root. */
  current: string
  /** Candidate root selected from attached folders. */
  selected: string
  /** Whether replacing the companion would interrupt an active turn. */
  turnRunning: boolean
  /** Confirmation used only for a disruptive replacement. */
  confirm: () => Promise<boolean>
}

/**
 * Select the first companion root without running executable settings in an untrusted workspace.
 * @param options - trust, attached roots, and optional picker.
 * @returns the selected root, or undefined when the picker is cancelled.
 */
export async function chooseInitialWorkspace(options: InitialWorkspaceOptions): Promise<string | undefined> {
  if (!options.trusted) throw new Error('Trust this workspace before starting the Harness runtime')
  if (options.folders.length === 0) throw new Error('Open a workspace folder before starting the Harness runtime')
  if (options.folders.length === 1) return options.folders[0]
  if (options.pick === undefined) throw new Error('Multiple workspace folders require an explicit selection')
  return options.pick(options.folders)
}

/**
 * Confirm only a root switch that would interrupt a running turn.
 * @param options - current/candidate roots, turn state, and confirmation port.
 * @returns the accepted root, or undefined when unchanged or cancelled.
 */
export async function chooseReplacementWorkspace(
  options: ReplacementWorkspaceOptions,
): Promise<string | undefined> {
  if (options.selected === options.current) return undefined
  if (options.turnRunning && !await options.confirm()) return undefined
  return options.selected
}
