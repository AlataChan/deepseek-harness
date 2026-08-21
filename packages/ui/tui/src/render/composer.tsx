/** Terminal composer presentation. @module @deepseek-ai/dsh-tui/render/composer */

import { Box, Text } from 'ink'
import type { EditorState } from '../state/editor.ts'

/** Properties for the selection-free composer view. */
export interface ComposerProps {
  readonly editor: EditorState
  readonly enabled: boolean
  readonly compact: boolean
}

/**
 * Render the store-owned draft without creating component-local text state.
 * @param props - editor snapshot and layout facts.
 * @returns one inline composer row.
 */
export function Composer({ editor, enabled, compact }: ComposerProps): React.JSX.Element {
  const prefix = compact ? '›' : 'You ›'
  const placeholder = enabled ? 'Type a message' : 'Waiting…'
  return <Box>
    <Text dimColor={!enabled}>{prefix} {editor.text === '' ? placeholder : editor.text}</Text>
  </Box>
}
