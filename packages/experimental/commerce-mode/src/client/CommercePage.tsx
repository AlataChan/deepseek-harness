/**
 * Root-scope commerce gate: the packaged sample first, then one upload per
 * table family with the platform that produced it, then 开始提问.
 */

import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { bytesToBase64 } from '@deepseek-ai/dsh-util-crypto'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CommerceKey } from './locales.ts'
import css from './CommercePage.module.css'

/** Table families one commerce source holds. */
export type CommerceTableKind = 'orders' | 'products' | 'inventory'

/** Locale keys of the table-family labels, in upload order. */
const KIND_KEYS = {
  orders: 'page.kind.orders',
  products: 'page.kind.products',
  inventory: 'page.kind.inventory',
} as const satisfies Record<CommerceTableKind, CommerceKey>

const PITFALL_KEYS = ['page.pitfall1', 'page.pitfall2', 'page.pitfall3', 'page.pitfall4'] as const

/** One listed commerce source from the Host. */
export interface CommerceListedSource {
  readonly id: string
  readonly displayName: string
  readonly kinds: readonly CommerceTableKind[]
}

/** One imported table as shown in preview. */
export interface CommerceListedTable {
  readonly kind: CommerceTableKind
  readonly rowCount: number
  readonly columns: readonly string[]
}

/** Import preview returned by the Host. */
export interface CommerceListedPreview {
  readonly source: CommerceListedSource
  readonly tables: readonly CommerceListedTable[]
  readonly warnings: readonly string[]
}

/** Host remotes the page calls. */
export interface CommercePageRemotes {
  listSources: (signal?: AbortSignal) => Promise<RemoteResult<readonly CommerceListedSource[]>>
  listPlatforms: () => Promise<RemoteResult<readonly string[]>>
  importSpreadsheet: (
    request: {
      filename: string
      bytes: string
      kind: CommerceTableKind
      platform: string
      sourceId?: string
    },
    signal?: AbortSignal,
  ) => Promise<RemoteResult<CommerceListedPreview>>
  importSample: (signal?: AbortSignal) => Promise<RemoteResult<CommerceListedPreview>>
  commit: (
    request: { sourceId: string; sessionId?: string; workspaceId?: string },
    signal?: AbortSignal,
  ) => Promise<RemoteResult<{ sessionId: string }>>
}

/** Page actions that live outside the Host remotes. */
export interface CommercePageActions {
  cancel: () => Promise<void>
  onCommitted: (sessionId: string) => void
  /** Blank Session this commit may reuse instead of creating one. */
  currentBlankSessionId?: string
  workspaceId?: string
}

/** Full props for the commerce gate. */
export interface CommercePageProps extends CommercePageRemotes, CommercePageActions {
  t: (key: CommerceKey, params?: Record<string, string | number>) => string
}

/**
 * Render the commerce source gate.
 * @param props - Host remotes, page actions, and the commerce locale seat.
 * @returns the gate page.
 */
export function CommercePage({
  listSources, listPlatforms, importSpreadsheet, importSample, commit,
  cancel, onCommitted, currentBlankSessionId, workspaceId, t,
}: CommercePageProps) {
  const [sources, setSources] = useState<readonly CommerceListedSource[]>([])
  const [platforms, setPlatforms] = useState<readonly string[]>([])
  const [platform, setPlatform] = useState<string | undefined>()
  const [kind, setKind] = useState<CommerceTableKind>('orders')
  const [selected, setSelected] = useState<string | undefined>()
  const [preview, setPreview] = useState<CommerceListedPreview | undefined>()
  const [failure, setFailure] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      const [listed, configured] = await Promise.all([
        listSources(controller.signal),
        listPlatforms(),
      ])
      if (controller.signal.aborted) return
      if (listed.ok) setSources(listed.value)
      if (configured.ok) {
        setPlatforms(configured.value)
        setPlatform(current => current ?? configured.value[0])
      }
    })()
    return () => { controller.abort() }
  }, [listSources, listPlatforms])

  const adopt = (imported: CommerceListedPreview): void => {
    setPreview(imported)
    setSelected(imported.source.id)
    setSources(current => [
      imported.source,
      ...current.filter(source => source.id !== imported.source.id),
    ])
  }

  const run = async (operation: () => Promise<RemoteResult<CommerceListedPreview>>): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    const result = await operation()
    setBusy(false)
    if (result.ok) adopt(result.value)
    else setFailure(t('page.failed', { reason: result.error.message }))
  }

  const onSample = (): void => { void run(() => importSample()) }

  const onUpload = (file: File | undefined): void => {
    if (file === undefined || platform === undefined) return
    void run(async () => importSpreadsheet({
      filename: file.name,
      bytes: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      kind,
      platform,
      ...selected === undefined ? {} : { sourceId: selected },
    }))
  }

  const onStart = (): void => {
    if (selected === undefined) return
    setBusy(true)
    setFailure(undefined)
    void (async () => {
      const result = await commit({
        sourceId: selected,
        ...currentBlankSessionId === undefined ? {} : { sessionId: currentBlankSessionId },
        ...workspaceId === undefined ? {} : { workspaceId },
      })
      setBusy(false)
      if (result.ok) onCommitted(result.value.sessionId)
      else setFailure(t('page.commitFailed', { reason: result.error.message }))
    })()
  }

  return (
    <section className={css.page} aria-label={t('page.title')}>
      <h2 className={css.title}>{t('page.title')}</h2>
      <p className={css.lead}>{t('page.lead')}</p>

      <div className={css.actions}>
        <Button variant="primary" disabled={busy} onClick={onSample}>{t('page.sample')}</Button>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('page.kind')}</span>
          <select
            className={css.select}
            value={kind}
            aria-label={t('page.kind')}
            onChange={(event) => { setKind(event.target.value as CommerceTableKind) }}
          >
            {(Object.keys(KIND_KEYS) as CommerceTableKind[]).map(value => (
              <option key={value} value={value}>{t(KIND_KEYS[value])}</option>
            ))}
          </select>
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('page.platform')}</span>
          <select
            className={css.select}
            value={platform ?? ''}
            aria-label={t('page.platform')}
            onChange={(event) => { setPlatform(event.target.value) }}
          >
            {platforms.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className={css.upload}>
          <span>{t('page.upload')}</span>
          <input
            type="file"
            accept=".csv,.xlsx"
            aria-label={t('page.upload')}
            disabled={busy || platform === undefined}
            onChange={(event) => {
              onUpload(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </label>
      </div>

      {failure === undefined ? null : <p className={css.failure}>{failure}</p>}
      {preview === undefined ? null : (
        <p className={css.preview}>
          {t('page.imported', {
            name: preview.source.displayName,
            tables: preview.tables
              .map(table => t('page.table', { kind: t(KIND_KEYS[table.kind]), rowCount: table.rowCount }))
              .join(' · '),
          })}
        </p>
      )}

      <div className={css.sources} aria-label={t('page.recent')}>
        <h3 className={css.sectionTitle}>{t('page.recent')}</h3>
        {sources.length === 0
          ? <p className={css.empty}>{t('page.empty')}</p>
          : (
            <ul className={css.sourceList}>
              {sources.map(source => (
                <li key={source.id}>
                  <button
                    type="button"
                    className={css.sourceRow}
                    data-selected={source.id === selected || undefined}
                    onClick={() => { setSelected(source.id) }}
                  >
                    <span className={css.sourceName}>{source.displayName}</span>
                    <span className={css.sourceKinds}>
                      {source.kinds.map(value => t(KIND_KEYS[value])).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>

      <section className={css.pitfalls} aria-label={t('page.pitfallsTitle')}>
        <h3 className={css.sectionTitle}>{t('page.pitfallsTitle')}</h3>
        <ul>
          {PITFALL_KEYS.map(key => <li key={key}>{t(key)}</li>)}
        </ul>
      </section>

      <div className={css.footer}>
        <Button variant="ghost" onClick={() => { void cancel() }}>{t('page.cancel')}</Button>
        <Button variant="primary" disabled={busy || selected === undefined} onClick={onStart}>
          {t('page.start')}
        </Button>
      </div>
    </section>
  )
}
