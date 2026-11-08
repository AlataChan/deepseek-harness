/**
 * Lightweight tool card component for Agent-Reach tool calls and results.
 *
 * @module @deepseek-ai/dsh-experimental-agent-reach/client/ReachCard
 */

import React from 'react'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ReachCard.module.css'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { NS, type ReachLocaleKey } from './locales.ts'

export type ReachCardProps = ToolCallViewProps & PropsLocale<typeof NS>

/**
 * Render an Agent-Reach tool call card with status badges and durable facts.
 *
 * @param props - ToolCallViewProps and locale helper
 * @returns React element
 */
export function ReachCard(props: ReachCardProps): React.ReactElement {
  const { block, toolName, t } = props
  const isResult = 'kind' in block
  const meta = (isResult && typeof block.meta === 'object' && block.meta !== null && !Array.isArray(block.meta)
    ? (block.meta as Record<string, unknown>)
    : {})

  const argChannel = block.args.text('channel') ?? ''
  const argAction = block.args.text('action') ?? ''
  const argBackend = block.args.text('backend') ?? ''

  const channel = (typeof meta['channel'] === 'string' ? meta['channel'] : '') || argChannel
  const action = (typeof meta['action'] === 'string' ? meta['action'] : '') || argAction
  const backend = (typeof meta['backend'] === 'string' ? meta['backend'] : '') || argBackend
  const accessScope = typeof meta['accessScope'] === 'string' ? meta['accessScope'] : ''
  const completeness = typeof meta['completeness'] === 'string' ? meta['completeness'] : ''
  const itemCount = typeof meta['itemCount'] === 'number' ? meta['itemCount'] : undefined
  const isError = isResult && block.isError
  const errorCode = (typeof meta['errorCode'] === 'string' ? meta['errorCode'] : '') || (isError ? (block.error?.code ?? 'ERROR') : undefined)
  const setupStatus = typeof meta['status'] === 'string' ? meta['status'] : ''

  const isSetup = toolName === 'reach_setup'

  const labels: Record<string, ReachLocaleKey> = {
    reach_channels:'tool.reach_channels',reach_status:'tool.reach_status',reach_query:'tool.reach_query',reach_setup:'tool.reach_setup',
    public:'scope.public',native:'scope.native',session:'scope.session',complete:'completeness.complete',
    truncated:'completeness.truncated',partial:'completeness.partial',snippet:'completeness.snippet',unknown:'completeness.unknown',
    planned:'setup.status.planned',installed:'setup.status.installed',declined:'setup.status.declined',
    failed:'setup.status.failed',not_needed:'setup.status.not_needed',unsupported:'setup.status.unsupported',
  }
  return (
    <div className={css.card}>
      <div className={css.heading}>{t(labels[toolName] ?? 'tool.reach_query')}</div>
      <div className={css.facts}>
        {channel && <Tag tone="info">{channel}{action ? ` / ${action}` : ''}</Tag>}
        {backend && <span>{t('card.backend')}: {backend}</span>}
        {accessScope && <Tag>{t(labels[accessScope] ?? 'completeness.unknown')}</Tag>}
        {completeness && <Tag>{t(labels[completeness] ?? 'completeness.unknown')}</Tag>}
        {itemCount !== undefined && <span>{t('card.items', { count:itemCount })}</span>}
        {isSetup && setupStatus && <Tag>{t(labels[setupStatus] ?? 'completeness.unknown')}</Tag>}
        {errorCode && <Tag tone="danger">{errorCode}</Tag>}
      </div>
    </div>
  )
}

export default ReachCard
