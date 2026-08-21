/** Inline transcript presentation. @module @deepseek-ai/dsh-tui/render/transcript */

import { Box, Static, Text } from 'ink'
import type { LiveAssistantRow, TranscriptRow } from '../state/types.ts'
import { ToolCard } from './tool.tsx'
import type { ToolCardModel } from './tool-model.ts'

/** Properties for finalized and live transcript output. */
export interface TranscriptProps {
  readonly rows: readonly TranscriptRow[]
  readonly live: LiveAssistantRow | undefined
}

/** Properties for a tool row already projected through its owning definition. */
export interface TranscriptToolProps {
  readonly model: ToolCardModel
}

/**
 * Render one tool card in the same transcript presentation family.
 * @param props - safe tool presentation model.
 * @returns the compact tool card.
 */
export function TranscriptTool({ model }: TranscriptToolProps): React.JSX.Element {
  return <ToolCard model={model} />
}

function label(row: TranscriptRow): string {
  if (row.kind !== 'message') return row.kind === 'error' ? 'Error' : 'System'
  return row.role === 'user' ? 'You' : 'Assistant'
}

/**
 * Render monotonic finalized rows through Ink Static and the current assistant below it.
 * @param props - finalized and live transcript values.
 * @returns terminal transcript elements.
 */
export function Transcript({ rows, live }: TranscriptProps): React.JSX.Element {
  return <>
    <Static items={[...rows]}>
      {row => <Box key={row.id} flexDirection="column">
        <Text bold>{label(row)}</Text>
        <Text>{row.text}</Text>
      </Box>}
    </Static>
    {live === undefined ? null : <Box flexDirection="column">
      <Text bold>Assistant</Text>
      <Text>{live.text}</Text>
    </Box>}
  </>
}
