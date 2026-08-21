/** Runtime status presentation. @module @deepseek-ai/dsh-tui/render/status */

import React from 'react'
import { Text } from 'ink'
import type { TuiStatus } from '../state/types.ts'

/** Properties for one status line. */
export interface StatusProps {
  readonly status: TuiStatus
  readonly compact: boolean
}

/**
 * Render idle, running, or failed runtime status.
 * @param props - current status and layout density.
 * @returns one status element.
 */
export function StatusLine({ status, compact }: StatusProps): React.JSX.Element {
  if (status.kind === 'failed') return <Text color="red">Error: {status.message}</Text>
  const value = status.kind === 'running' ? 'working' : 'ready'
  return <Text dimColor>{compact ? value : `Status: ${value}`}</Text>
}
