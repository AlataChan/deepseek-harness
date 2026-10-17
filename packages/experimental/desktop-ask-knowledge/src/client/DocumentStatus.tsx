/**
 * Component for displaying document retention, searchability, and extraction progress.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/client/DocumentStatus
 */

import { useRef, useState } from 'react'
import type { AskKnowledgeKey } from './locales.ts'
import css from './DocumentStatus.module.css'

/** State of one document in the library. */
export interface DocumentStatusItem {
  readonly libraryId?: string
  readonly planHash?: string
  readonly error?: string
  readonly id: string
  readonly filename: string
  readonly revisionId?: string
  readonly conversionStatus?: string
  readonly originalAvailable: boolean
  readonly textAvailable?: boolean
  readonly searchable: boolean
  readonly stage?: string
  readonly status: 'active' | 'completed' | 'failed' | 'paused' | 'queued' | 'retained' | 'cancelled'
  readonly totalChunks?: number
  readonly completedChunks?: number
  readonly tokensUsed?: number
  readonly usageKnown?: boolean
  readonly retryRequired?: boolean
  readonly chunksWithoutPages?: number
  readonly wikiReady?: boolean
  readonly estimatedTokens?: number
  readonly budgetApproved?: boolean
  readonly uncertainOutcome?: 'replay'
  readonly needsOcrPage?: number
}

/** Props for DocumentStatus. */
export interface DocumentStatusProps {
  readonly item: DocumentStatusItem
  readonly t: (key: AskKnowledgeKey) => string
  readonly onOpenOriginal?: ((item: DocumentStatusItem) => void | Promise<void>) | undefined
  readonly onViewText?: ((item: DocumentStatusItem) => void | Promise<void>) | undefined
  readonly onViewSources?: ((item: DocumentStatusItem) => void | Promise<void>) | undefined
  readonly onRetry?: ((item: DocumentStatusItem) => void | Promise<void>) | undefined
  readonly onResume?: ((item: DocumentStatusItem) => void | Promise<void>) | undefined
  readonly onCancel?: ((item: DocumentStatusItem) => void | Promise<void>) | undefined
  readonly onApproveBudget?: ((item: DocumentStatusItem) => void | Promise<void>) | undefined
}

/**
 * Render one document card with status badges and lifecycle controls.
 * @param props - document status item and callbacks.
 * @returns rendered document status card.
 */
export function DocumentStatus({
  item,
  t,
  onOpenOriginal,
  onViewText,
  onViewSources,
  onRetry,
  onResume,
  onCancel,
  onApproveBudget,
}: DocumentStatusProps) {
  const pending = useRef(new Set<string>())
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(new Set())
  const [actionError, setActionError] = useState<string>()
  const paidBusy = ['approve', 'resume', 'retry', 'cancel'].some(action => pendingActions.has(action))
  const runAction = (kind: string, action: ((target: DocumentStatusItem) => void | Promise<void>) | undefined, target = item) => {
    if (!action || pending.current.has(kind) ||
      (kind !== 'cancel' && ['approve', 'resume', 'retry'].includes(kind) &&
        ['approve', 'resume', 'retry', 'cancel'].some(value => pending.current.has(value)))) return
    pending.current.add(kind)
    setPendingActions(new Set(pending.current))
    setActionError(undefined)
    const finish = () => { pending.current.delete(kind); setPendingActions(new Set(pending.current)) }
    const failed = (error: unknown) => { setActionError(error instanceof Error ? error.message : t('error.docsFailed')) }
    try {
      const result = action(target)
      if (result === undefined) finish()
      else void result.catch(failed).finally(finish)
    } catch (error) { failed(error); finish() }
  }
  const isOriginalSaved = item.originalAvailable
  const showProgress = typeof item.totalChunks === 'number' && typeof item.completedChunks === 'number' && item.totalChunks > 0
  const progressText = showProgress
    ? t('docs.searchableWithProgress')
      .replace('{completed}', String(item.completedChunks))
      .replace('{total}', String(item.totalChunks))
    : t('docs.textSearchable')

  const estimateText = t(item.budgetApproved ? 'docs.approvedEstimate' : 'docs.estimate').replace('{tokens}', (item.estimatedTokens ?? 0).toLocaleString()).replace('{chunks}', String(item.totalChunks ?? 0))
  const ocrText = typeof item.needsOcrPage === 'number'
    ? t('docs.partialNeedsOcr').replace('{page}', String(item.needsOcrPage))
    : undefined

  return (
    <div className={css.card} data-testid={`doc-${item.id}`} aria-busy={pendingActions.size > 0}>
      <div className={css.header}>
        <span className={css.filename} title={item.filename}>{item.filename}</span>
        <div className={css.badges}>
          {isOriginalSaved ? (
            <span className={css.badgeSuccess}>{t('docs.originalSaved')}</span>
          ) : (
            <span className={css.badgeWarning}>{t('docs.originalUnavailable')}</span>
          )}

          {item.searchable && (
            <span className={css.badge}>{progressText}</span>
          )}

          {['partial', 'needs_ocr', 'unknown'].includes(item.conversionStatus ?? '') && (
            <span className={css.badgeWarning}>{t('docs.partialConversion')}</span>
          )}

          {ocrText !== undefined && (
            <span className={css.badgeWarning}>{ocrText}</span>
          )}

          {(item.status === 'active' || item.status === 'queued') && (
            <span className={css.badge}>{t(item.stage === 'conversion' ? 'docs.statusConverting' : 'docs.statusEnriching')}</span>
          )}

          {item.status === 'paused' && (
            <span className={css.badgeWarning}>{t(item.stage === 'awaiting_approval' ? 'docs.statusAwaitingApproval' : 'docs.statusPaused')}</span>
          )}

          {item.status === 'failed' && (
            <span className={css.badgeWarning}>{t('docs.statusFailed')}</span>
          )}

          {item.status === 'completed' && (
            <span className={item.wikiReady === true ? css.badgeSuccess : css.badgeWarning}>{t(item.wikiReady === true ? 'docs.statusCompleted' : 'docs.statusWikiIncomplete')}</span>
          )}
        </div>
      </div>

      {item.estimatedTokens !== undefined && item.estimatedTokens > 0 && <p>{estimateText}</p>}
      {item.tokensUsed !== undefined && <p>{t(item.usageKnown === false ? 'docs.usagePartial' : 'docs.usage').replace('{tokens}', item.tokensUsed.toLocaleString())}</p>}
      {(item.chunksWithoutPages ?? 0) > 0 && <p>{t('docs.chunksWithoutPages').replace('{chunks}', String(item.chunksWithoutPages))}</p>}
      {item.retryRequired && <p>{t('docs.retryRequired')}</p>}
      {item.stage === 'uncertain' && <p role="alert">{t('docs.uncertainWarning')}</p>}
      {item.error && <p role="alert">{item.error}</p>}
      {actionError && actionError !== item.error && <p role="alert">{actionError}</p>}
      {item.status === 'cancelled' && <p>{t('docs.statusCancelled')}</p>}
      <div className={css.actions}>
        {isOriginalSaved && onOpenOriginal !== undefined && (
          <button
            type="button"
            className={css.button}
            disabled={pendingActions.has('original')}
            onClick={() => runAction('original', onOpenOriginal)}
          >
            {t('docs.openOriginal')}
          </button>
        )}

        {(item.textAvailable ?? item.searchable) && onViewText !== undefined && (
          <button
            type="button"
            className={css.button}
            disabled={pendingActions.has('text')}
            onClick={() => runAction('text', onViewText)}
          >
            {t('docs.viewExtracted')}
          </button>
        )}

        {onViewSources !== undefined && (
          <button
            type="button"
            className={css.button}
            disabled={pendingActions.has('sources')}
            onClick={() => runAction('sources', onViewSources)}
          >
            {t('docs.viewSources')}
          </button>
        )}

        {(item.status === 'failed' || (item.status === 'paused' && item.stage !== 'uncertain' && !!item.error)) && onRetry !== undefined && (
          <button
            type="button"
            className={css.button}
            disabled={paidBusy}
            onClick={() => runAction('retry', onRetry)}
          >
            {t('docs.retryStage')}
          </button>
        )}

        {item.status === 'paused' && !item.retryRequired && item.stage !== 'uncertain' && item.budgetApproved && onResume !== undefined && (
          <button
            type="button"
            className={css.button}
            disabled={paidBusy}
            onClick={() => runAction('resume', onResume)}
          >
            {t('docs.resumeExtraction')}
          </button>
        )}

        {item.stage === 'uncertain' && item.planHash && onResume !== undefined && (
          <button type="button" className={css.button} disabled={paidBusy} onClick={() => runAction('resume', onResume, { ...item, uncertainOutcome: 'replay' })}>
            {t('docs.replayUncertain')}
          </button>
        )}

        {(item.status === 'active'  || item.status === 'queued' || item.status === 'paused') && onCancel !== undefined && (
          <button
            type="button"
            className={css.buttonDanger}
            disabled={pendingActions.has('cancel')}
            onClick={() => runAction('cancel', onCancel)}
          >
            {t('docs.cancelProcessing')}
          </button>
        )}

        {(item.estimatedTokens ?? 0) > 0 && item.planHash !== undefined && item.stage !== 'uncertain' && item.status === 'paused' && item.stage === 'awaiting_approval' && !item.budgetApproved && onApproveBudget !== undefined && (
          <button
            type="button"
            className={css.button}
            disabled={paidBusy}
            onClick={() => runAction('approve', onApproveBudget)}
          >
            {t('docs.approveBudget')}
          </button>
        )}
      </div>
    </div>
  )
}
