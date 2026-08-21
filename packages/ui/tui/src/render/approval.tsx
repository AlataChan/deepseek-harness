/** Approval decision panel. @module @deepseek-ai/dsh-tui/render/approval */

import { Box, Text } from 'ink'
import type { PendingInteraction } from '../state/types.ts'

type ApprovalInteraction = Extract<PendingInteraction, { kind: 'approval' }>

/** Properties for one visible approval request. */
export interface ApprovalPanelProps {
  readonly interaction: ApprovalInteraction
}

/**
 * Render the exact tool identity and reason awaiting a decision.
 * @param props - immutable approval description.
 * @returns an allow-once/reject decision panel.
 */
export function ApprovalPanel({ interaction }: ApprovalPanelProps): React.JSX.Element {
  return <Box borderStyle="round" flexDirection="column">
    <Text bold>Approval required · {interaction.toolName}</Text>
    {interaction.callId === undefined ? null : <Text>Call: {interaction.callId}</Text>}
    {interaction.reason === undefined ? null : <Text>{interaction.reason}</Text>}
    <Text>Allow once / Reject</Text>
  </Box>
}
