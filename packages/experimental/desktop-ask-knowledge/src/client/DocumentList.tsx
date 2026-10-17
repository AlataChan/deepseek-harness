/**
 * List of documents in a library with extraction status and controls.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/client/DocumentList
 */

import type { AskKnowledgeKey } from './locales.ts'
import { DocumentStatus, type DocumentStatusItem } from './DocumentStatus.tsx'
import css from './DocumentList.module.css'

/** Props for DocumentList. */
export interface DocumentListProps {
  readonly items: readonly DocumentStatusItem[]
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
 * Render list of documents in a library.
 * @param props - items and callbacks.
 * @returns rendered document list.
 */
export function DocumentList({
  items,
  t,
  onOpenOriginal,
  onViewText,
  onViewSources,
  onRetry,
  onResume,
  onCancel,
  onApproveBudget,
}: DocumentListProps) {
  return (
    <div className={css.container}>
      <div className={css.header}>
        <h3 className={css.title}>{t('docs.title')}</h3>
      </div>
      {items.length === 0 ? (
        <p className={css.empty}>{t('docs.empty')}</p>
      ) : (
        <ul className={css.list}>
          {items.map(item => (
            <li key={item.id}>
              <DocumentStatus
                item={item}
                t={t}
                onOpenOriginal={onOpenOriginal}
                onViewText={onViewText}
                onViewSources={onViewSources}
                onRetry={onRetry}
                onResume={onResume}
                onCancel={onCancel}
                onApproveBudget={onApproveBudget}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
