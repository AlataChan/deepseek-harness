/** Terminal overlay presentation. @module @deepseek-ai/dsh-tui/render/overlays */

import { Box, Text } from 'ink'
import type { ResumeRow } from '../driver/resume.ts'
import type { PendingInteraction, TuiOverlay } from '../state/types.ts'

/** Properties for the exclusive terminal overlay. */
export interface OverlaysProps {
  readonly overlay: TuiOverlay
  readonly interaction: PendingInteraction | undefined
  readonly resumeRows: readonly ResumeRow[]
}

/**
 * Render the currently active navigation or interaction panel.
 * @param props - exclusive overlay state and immutable resume choices.
 * @returns the overlay panel or no terminal element.
 */
export function Overlays({ overlay, interaction, resumeRows }: OverlaysProps): React.JSX.Element | null {
  switch (overlay.kind) {
    case 'none':
      return null
    case 'help':
      return <Box borderStyle="round" flexDirection="column">
        <Text bold>Keyboard help</Text>
        <Text>Enter submit · Ctrl+J newline · Ctrl+R resume · Ctrl+C cancel or exit</Text>
      </Box>
    case 'resume':
      return <Box borderStyle="round" flexDirection="column">
        <Text bold>Resume session</Text>
        {resumeRows.length === 0
          ? <Text dimColor>No saved sessions</Text>
          : resumeRows.map(row => <Text key={row.sessionId}>
            {row.title} · {row.sessionId}{row.cwd === undefined ? '' : ` · ${row.cwd}`}
          </Text>)}
      </Box>
    case 'approval':
    case 'question':
      return <Box borderStyle="round"><Text>{interaction?.prompt ?? 'Interaction pending'}</Text></Box>
  }
}
