/** Inline transcript presentation. @module @deepseek-ai/dsh-tui/render/transcript */

import { Box, Static, Text } from 'ink'
import type { LiveAssistantRow, TranscriptRow } from '../state/types.ts'
import { ToolCard } from './tool.tsx'
import type { ToolCardModel } from './tool-model.ts'
import type { ProjectedTranscriptRow, TranscriptProjection } from '../transcript/project.ts'

/** Properties for finalized and live transcript output. */
export interface TranscriptProps {
  readonly rows: readonly TranscriptRow[]
  readonly live: LiveAssistantRow | undefined
  readonly projection?: TranscriptProjection
  readonly projectTool?: (row: Extract<ProjectedTranscriptRow, { kind: 'tool-call' | 'tool-result' }>) => ToolCardModel
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
export function Transcript({ rows, live, projection, projectTool }: TranscriptProps): React.JSX.Element {
  return <>
    {projection === undefined ? null : <ProjectedTranscript projection={projection} projectTool={projectTool} />}
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

function projectedText(row: Exclude<ProjectedTranscriptRow, { kind: 'tool-call' | 'tool-result' }>): string {
  switch (row.kind) {
    case 'message': return row.text
    case 'reasoning': return row.text
    case 'command': return [row.name === undefined ? undefined : `/${row.name}`, row.text].filter(Boolean).join(' ')
    case 'retry': return row.text
    case 'status': return row.text
    case 'error': return row.text
  }
}

function projectedLabel(row: Exclude<ProjectedTranscriptRow, { kind: 'tool-call' | 'tool-result' }>): string {
  switch (row.kind) {
    case 'message': return row.role === 'user' ? 'You' : 'Assistant'
    case 'reasoning': return 'Reasoning'
    case 'command': return 'Command'
    case 'retry': return 'Retry'
    case 'status': return 'System'
    case 'error': return 'Error'
  }
}

/** Render the authoritative Session projection with tool-owned cards. */
export function ProjectedTranscript({
  projection,
  projectTool,
}: {
  readonly projection: TranscriptProjection
  readonly projectTool?: TranscriptProps['projectTool']
}): React.JSX.Element {
  return <>
    <Static items={[...projection.rows].map((row, index) => ({ row, key: `${row.sourceSeq}-${index}` }))}>
      {item => <Box key={item.key} flexDirection="column">
        {item.row.kind === 'tool-call' || item.row.kind === 'tool-result'
          ? projectTool === undefined
            ? <><Text bold>{item.row.name || 'Tool'}</Text><Text>{item.row.kind === 'tool-call' ? item.row.arguments : item.row.text}</Text></>
            : <ToolCard model={projectTool(item.row)} />
          : <><Text bold>{projectedLabel(item.row)}</Text><Text>{projectedText(item.row)}</Text></>}
      </Box>}
    </Static>
    {projection.liveReasoning === undefined ? null : <Box flexDirection="column"><Text bold>Reasoning</Text><Text>{projection.liveReasoning}</Text></Box>}
    {projection.liveAssistant === undefined ? null : <Box flexDirection="column"><Text bold>Assistant</Text><Text>{projection.liveAssistant}</Text></Box>}
  </>
}
