/** Terminal composer presentation. @module @deepseek-ai/dsh-tui/render/composer */

import { Box, Text, useInput } from 'ink'
import type { TuiInputDriver } from '../driver/input.ts'
import type { EditorState } from '../state/editor.ts'

/** Properties for the selection-free composer view. */
export interface ComposerProps {
  readonly editor: EditorState
  readonly enabled: boolean
  readonly compact: boolean
  readonly input?: TuiInputDriver
  readonly onInputError?: (error: unknown) => void
}

/**
 * Render the store-owned draft without creating component-local text state.
 * @param props - editor snapshot and layout facts.
 * @returns one inline composer row.
 */
export function Composer({ editor, enabled, compact, input, onInputError }: ComposerProps): React.JSX.Element {
  useInput((value, key) => {
    if (input === undefined) return
    const name = key.return ? 'return' : key.escape ? 'escape' : value
    void input.handle(value, { ...key, name }).catch((error: unknown) => { onInputError?.(error) })
  }, { isActive: input !== undefined })
  const prefix = compact ? '›' : 'You ›'
  const placeholder = enabled ? 'Type a message' : 'Waiting…'
  return <Box>
    <Text dimColor={!enabled}>{prefix} {editor.text === '' ? placeholder : editor.text}</Text>
  </Box>
}
