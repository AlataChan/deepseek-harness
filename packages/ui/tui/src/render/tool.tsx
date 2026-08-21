/** Compact Ink components for tool-owned presentation intents. @module @deepseek-ai/dsh-tui/render/tool */

import { Box, Text } from 'ink'
import type { ToolCardDetail, ToolCardModel, ToolDiffModel } from './tool-model.ts'

/** Properties for one tool card. */
export interface ToolCardProps {
  readonly model: ToolCardModel
}

function Diff({ diff }: { readonly diff: ToolDiffModel }): React.JSX.Element {
  const oldLines = diff.oldText?.split('\n') ?? []
  const newLines = diff.newText.split('\n')
  return <Box flexDirection="column">
    <Text>--- {diff.oldText === null ? '/dev/null' : diff.path}</Text>
    <Text>+++ {diff.path}</Text>
    <Text>@@</Text>
    {oldLines.map((line, index) => <Text key={`old-${index}`} color="red">-{line}</Text>)}
    {newLines.map((line, index) => <Text key={`new-${index}`} color="green">+{line}</Text>)}
  </Box>
}

function Detail({ detail }: { readonly detail: ToolCardDetail }): React.JSX.Element {
  switch (detail.card) {
    case 'generic':
      return <Box flexDirection="column">
        {detail.content.map((line, index) => <Text key={index}>{line}</Text>)}
      </Box>
    case 'terminal':
      return <Box borderStyle="round" flexDirection="column">
        {detail.description === undefined ? null : <Text>{detail.description}</Text>}
        {detail.cwd === undefined ? null : <Text dimColor>{detail.cwd}</Text>}
        {detail.command === undefined ? null : <Text>$ {detail.command}</Text>}
        {detail.output === undefined ? null : <Text>{detail.output}</Text>}
        {detail.exit === undefined ? null : <Text dimColor>{detail.exit}</Text>}
      </Box>
    case 'diff':
      return <Box flexDirection="column">
        {detail.diffs.map((diff, index) => <Diff key={`${diff.path}-${index}`} diff={diff} />)}
      </Box>
    case 'read':
      return <Box flexDirection="column">
        <Text>{detail.path} · {detail.lines.length} of {detail.totalLines} lines</Text>
        {detail.lines.map(line => <Text key={line.number}>{line.number} │ {line.text}</Text>)}
      </Box>
    case 'search':
    case 'web':
      return <Box flexDirection="column">
        <Text>{detail.summary}</Text>
        {detail.rows.map((row, index) => <Text key={index}>{row}</Text>)}
      </Box>
  }
}

/**
 * Render one safe tool card without executing or enriching its content.
 * @param props - projected terminal card model.
 * @returns a compact Ink tool card.
 */
export function ToolCard({ model }: ToolCardProps): React.JSX.Element {
  return <Box flexDirection="column">
    <Text bold>{model.title}{model.isError ? ' · failed' : ''}</Text>
    <Detail detail={model.detail} />
  </Box>
}
