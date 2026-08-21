/** Terminal composer presentation. @module @deepseek-ai/dsh-tui/render/composer */

import React from 'react'
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
  const prefix = compact ? '›' : 'You ›'
  const placeholder = enabled ? 'Type a message' : 'Waiting…'
  const content = <Box>
    <Text dimColor={!enabled}>{prefix} {editor.text === '' ? placeholder : editor.text}</Text>
  </Box>
  return input === undefined ? content : <InteractiveComposer input={input} onInputError={onInputError}>
    {content}
  </InteractiveComposer>
}

function InteractiveComposer({ input, onInputError, children }: {
  readonly input: TuiInputDriver
  readonly onInputError: ComposerProps['onInputError']
  readonly children: React.JSX.Element
}): React.JSX.Element {
  useInput((value, key) => {
    void input.handle(value, key).catch((error: unknown) => { onInputError?.(error) })
  })
  return children
}
