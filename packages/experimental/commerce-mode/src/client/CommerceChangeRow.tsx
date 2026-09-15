/**
 * Keyed tool card for commerce staging, discard, and export calls: a summary row whose body shows
 * the staged before/after lines or the written export file, plus the current ledger counts.
 */

import { useState, type ReactNode } from 'react'
import {
  DisclosureRow, IconDownloadOutline16, IconInspectOutline12, IconListPenOutline16, IconTrashOutline16, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { CommerceChangeKind, CommerceValue } from '@deepseek-ai/dsh-host-commerce/types'
// Type-only: the Session standard kit merge that supplies useProjection.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: the `commerceSession` projection declaration read by the ledger line.
import type {} from '../tools/types.ts'
import css from './CommerceChangeRow.module.css'
import type { CommerceKey } from './locales.ts'
import {
  callSummary, commerceCardModel, DISCARD_TOOL_NAME, EXPORT_TOOL_NAME, firstLine, ledgerCounts,
  type CommerceCardModel, type CommerceRowState, type StagedChangeModel,
} from './models.ts'

type CommerceChangeRowProps = ToolCallViewProps & PropsLocale<'commerce-mode'>
type Translate = CommerceChangeRowProps['t']

/** Written export file named by an export result. */
interface ExportFile {
  readonly path: string
  readonly changeIds: readonly string[]
}

const KIND_KEYS = {
  'listing-update': 'kind.listing-update',
  'price-change': 'kind.price-change',
  promotion: 'kind.promotion',
  restock: 'kind.restock',
  campaign: 'kind.campaign',
} as const satisfies Record<CommerceChangeKind, CommerceKey>

/** Hidden status copy for the lifecycle states the row marks only by colour or motion. */
const STATUS_KEYS: Readonly<Record<CommerceRowState, CommerceKey | null>> = {
  running: 'row.running',
  ok: null,
  error: 'row.failed',
  stopped: 'row.stopped',
}

function titleKey(toolName: string): CommerceKey {
  if (toolName === DISCARD_TOOL_NAME) return 'row.discard'
  if (toolName === EXPORT_TOOL_NAME) return 'row.export'
  return 'row.stage'
}

function leadingIcon(toolName: string, state: CommerceRowState): ReactNode {
  if (state === 'error') return <StateDot state="error" />
  if (state === 'stopped') return <StateDot state="warning" />
  if (toolName === DISCARD_TOOL_NAME) return <IconTrashOutline16 />
  if (toolName === EXPORT_TOOL_NAME) return <IconDownloadOutline16 />
  return <IconListPenOutline16 />
}

function exportFileOf(model: CommerceCardModel): ExportFile | null {
  if (model.exportPath === null || model.exportedChangeIds === null) return null
  return { path: model.exportPath, changeIds: model.exportedChangeIds }
}

function summaryText(model: CommerceCardModel, block: CommerceChangeRowProps['block'], t: Translate): string {
  if (model.state === 'error' && model.output !== null) return firstLine(model.output)
  if (model.staged !== null) return `${model.staged.id} · ${t(KIND_KEYS[model.staged.kind])} · ${model.staged.summary}`
  if (model.discardedChangeId !== null) return t('discard.summary', { id: model.discardedChangeId })
  const file = exportFileOf(model)
  if (file !== null) return t('export.summary', { count: file.changeIds.length, path: file.path })
  if (model.output !== null) return firstLine(model.output)
  return callSummary(block)
}

function ChangeTable({ change, t }: { change: StagedChangeModel; t: Translate }) {
  const show = (value: CommerceValue): string => value === null ? t('change.empty') : String(value)
  return (
    <section className={css.panel} aria-label={t('change.table')}>
      <div className={css.panelHeader}>{t('change.table')}</div>
      <div className={css.tableWrap}>
        <table className={css.table}>
          <thead>
            <tr>
              <th>{t('change.listing')}</th>
              <th>{t('change.field')}</th>
              <th>{t('change.before')}</th>
              <th>{t('change.after')}</th>
            </tr>
          </thead>
          <tbody>
            {change.items.map(item => (
              <tr key={`${item.listingId ?? ''}/${item.field}`}>
                <td>{item.listingId ?? t('change.campaignLevel')}</td>
                <td>{item.field}</td>
                <td className={css.before}>{show(item.before)}</td>
                <td className={css.after}>{show(item.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {change.window === null ? null : (
        <p className={css.note}>{t('change.window', { startsOn: change.window.startsOn, endsOn: change.window.endsOn })}</p>
      )}
      {change.campaign === null ? null : (
        <p className={css.note}>{t('change.campaign', { name: change.campaign.name, count: change.campaign.listingIds.length })}</p>
      )}
    </section>
  )
}

function ExportPanel({ file, openFile, t }: { file: ExportFile; openFile: (path: string) => void; t: Translate }) {
  return (
    <section className={css.panel} aria-label={t('export.file')}>
      <div className={css.panelHeader}>{t('export.file')}</div>
      <div className={css.fileRow}>
        <code className={css.path}>{file.path}</code>
        <button type="button" className={css.openButton} onClick={() => { openFile(file.path) }}>
          {t('export.open')}
        </button>
      </div>
      <p className={css.note}>{t('export.changes', { ids: file.changeIds.join(', ') })}</p>
      <p className={css.note}>{t('export.notice')}</p>
    </section>
  )
}

function LedgerLine({ useProjection, t }: Pick<CommerceChangeRowProps, 'useProjection' | 't'>) {
  const ledger = useProjection('commerceSession', value => value?.ledger)
  return ledger === undefined ? null : <p className={css.ledger}>{t('ledger.counts', ledgerCounts(ledger))}</p>
}

function detailFor(model: CommerceCardModel, openFile: (path: string) => void, t: Translate): ReactNode {
  if (model.staged !== null) return <ChangeTable change={model.staged} t={t} />
  const file = exportFileOf(model)
  if (file !== null) return <ExportPanel file={file} openFile={openFile} t={t} />
  return <pre className={css.output} data-error={model.state === 'error' || undefined}>{model.output}</pre>
}

/**
 * Render one commerce staging, discard, or export call.
 * @param props - keyed toolview payload, the Session projection reader, and the commerce locale seat.
 * @returns the commerce change card.
 */
export function CommerceChangeRow({ toolName, block, openFile, inspect, useProjection, t }: CommerceChangeRowProps) {
  const model = commerceCardModel(block)
  const [expanded, setExpanded] = useState(false)
  const expandable = model.output !== null
  const statusKey = STATUS_KEYS[model.state]
  const recorded = model.staged !== null || model.discardedChangeId !== null || exportFileOf(model) !== null
  return (
    <div className={css.card} data-tool={toolName} data-state={model.state}>
      <DisclosureRow
        icon={leadingIcon(toolName, model.state)}
        title={t(titleKey(toolName))}
        open={expanded && expandable}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            {statusKey === null ? null : <span className={css.visuallyHidden}>{t(statusKey)}</span>}
            <span className={css.separator} aria-hidden />
            <span className={model.state === 'error' ? `${css.summary} ${css.errorSummary}` : css.summary}>
              {summaryText(model, block, t)}
            </span>
          </>
        )}
      >
        <div className={css.body}>
          {detailFor(model, openFile, t)}
          {recorded ? <LedgerLine useProjection={useProjection} t={t} /> : null}
          {inspect === undefined ? null : (
            <button type="button" className={css.inspectButton} onClick={inspect}>
              <IconInspectOutline12 />
              {t('row.inspect')}
            </button>
          )}
        </div>
      </DisclosureRow>
    </div>
  )
}
