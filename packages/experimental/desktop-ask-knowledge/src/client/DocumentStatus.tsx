/**
 * Component for displaying document retention, searchability, and extraction progress.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/client/DocumentStatus
 */

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
  readonly searchable: boolean
  readonly stage?: string
  readonly status: 'active' | 'completed' | 'failed' | 'paused' | 'queued' | 'retained' | 'cancelled'
  readonly totalChunks?: number
  readonly completedChunks?: number
  readonly estimatedTokens?: number
  readonly budgetApproved?: boolean
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
  const isOriginalSaved = item.originalAvailable
  const showProgress = typeof item.totalChunks === 'number' && typeof item.completedChunks === 'number' && item.totalChunks > 0
  const progressText = showProgress
    ? t('docs.searchableWithProgress')
      .replace('{completed}', String(item.completedChunks))
      .replace('{total}', String(item.totalChunks))
    : t('docs.textSearchable')

  const estimateText = t('docs.estimate').replace('{tokens}', String(item.estimatedTokens ?? 0)).replace('{chunks}', String(item.totalChunks ?? 0))
  const ocrText = typeof item.needsOcrPage === 'number'
    ? t('docs.partialNeedsOcr').replace('{page}', String(item.needsOcrPage))
    : undefined

  return (
    <div className={css.card} data-testid={`doc-${item.id}`}>
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

          {item.status === 'paused' && (
            <span className={css.badgeWarning}>{t('docs.statusPaused')}</span>
          )}

          {item.status === 'failed' && (
            <span className={css.badgeWarning}>{t('docs.statusFailed')}</span>
          )}

          {item.status === 'completed' && (
            <span className={css.badgeSuccess}>{t('docs.statusCompleted')}</span>
          )}
        </div>
      </div>

      {item.estimatedTokens !== undefined && item.estimatedTokens > 0 && <p>{estimateText}</p>}
      {item.error && <p role="alert">{item.error}</p>}
      {item.status === 'cancelled' && <p>{t('docs.statusCancelled')}</p>}
      <div className={css.actions}>
        {isOriginalSaved && onOpenOriginal !== undefined && (
          <button
            type="button"
            className={css.button}
            onClick={() => onOpenOriginal(item)}
          >
            {t('docs.openOriginal')}
          </button>
        )}

        {onViewText !== undefined && (
          <button
            type="button"
            className={css.button}
            onClick={() => onViewText(item)}
          >
            {t('docs.viewExtracted')}
          </button>
        )}

        {onViewSources !== undefined && (
          <button
            type="button"
            className={css.button}
            onClick={() => onViewSources(item)}
          >
            {t('docs.viewSources')}
          </button>
        )}

        {item.status === 'failed' && onRetry !== undefined && (
          <button
            type="button"
            className={css.button}
            onClick={() => onRetry(item)}
          >
            {t('docs.retryStage')}
          </button>
        )}

        {item.status === 'paused' && item.budgetApproved && onResume !== undefined && (
          <button
            type="button"
            className={css.button}
            onClick={() => onResume(item)}
          >
            {t('docs.resumeExtraction')}
          </button>
        )}

        {(item.status === 'active' || item.status === 'queued' || item.status === 'paused') && onCancel !== undefined && (
          <button
            type="button"
            className={css.buttonDanger}
            onClick={() => onCancel(item)}
          >
            {t('docs.cancelProcessing')}
          </button>
        )}

        {(item.estimatedTokens ?? 0) > 0 && item.planHash !== undefined && item.status !== 'cancelled' && !item.budgetApproved && onApproveBudget !== undefined && (
          <button
            type="button"
            className={css.button}
            onClick={() => onApproveBudget(item)}
          >
            {t('docs.approveBudget')}
          </button>
        )}
      </div>
    </div>
  )
}
