/**
 * Root-scope data-source gate: sample first, then upload, then existing-database connect.
 */

import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { encodeAskDataBytes, readFileBytes } from './bytes.ts'
import type { AskDataKey } from './locales.ts'
import { PreviewPanel, type PreviewTable } from './PreviewPanel.tsx'
import {
  ASK_DATA_TEMPLATE_CSV,
  offerAskDataTemplate,
  type AskDataTemplateOffer,
} from './template.ts'
import css from './DataSourcePage.module.css'

const PITFALL_KEYS = ['pitfall1', 'pitfall2', 'pitfall3', 'pitfall4', 'pitfall5'] as const

/** One listed source row from the Host. */
export interface ListedSource {
  readonly id: string
  readonly displayName: string
  readonly kind: 'sample' | 'import' | 'saved'
  readonly lastUsedAt?: string
  readonly missing: boolean
  readonly warnings: readonly string[]
}

/** Import preview returned by the Host. */
export interface ListedPreview {
  readonly source: ListedSource
  readonly tables: readonly PreviewTable[]
  readonly warnings: readonly string[]
}

/** Host remotes the page calls. */
export interface DataSourcePageRemotes {
  listSources: (signal?: AbortSignal) => Promise<RemoteResult<readonly ListedSource[]>>
  importSpreadsheet: (
    request: { filename: string; bytes: string; replaceSourceId?: string },
    signal?: AbortSignal,
  ) => Promise<RemoteResult<ListedPreview>>
  importSample: (signal?: AbortSignal) => Promise<RemoteResult<ListedPreview>>
  commit: (
    request: { sourceId: string; sessionId?: string; workspaceId?: string },
    signal?: AbortSignal,
  ) => Promise<RemoteResult<{ sessionId: string }>>
  createAdvanced: (request: { workspaceId?: string }) => Promise<RemoteResult<{ sessionId: string }>>
}

/** Page actions that live outside the Host remotes. */
export interface DataSourcePageActions {
  cancel: () => Promise<void>
  onCommitted: (sessionId: string) => void
  onAdvanced: (sessionId: string) => void
  currentBlankSessionId?: string
  /** Current Session when it already carries an ask-data bind. */
  currentBound?: { sessionId: string; sourceId: string }
  workspaceId?: string
  sqlite3Missing?: boolean
}

/** Full props for the data-source gate. */
export interface DataSourcePageProps extends DataSourcePageRemotes, DataSourcePageActions {
  t: (key: AskDataKey) => string
}

const WARNING_KEYS: Record<string, AskDataKey> = {
  'merged-cells': 'warningMerged',
  'second-row-header': 'warningSecondHeader',
  'header-empty': 'warningHeaderEmpty',
  'header-duplicate': 'warningHeaderDuplicate',
  'sparse-first-row': 'warningSparse',
  'type-guess': 'warningTypeGuess',
  'sheet-name': 'warningSheetName',
}

/**
 * Render the 选一份要问的数据 page.
 * @param props - remotes, cancel/commit, locale.
 * @returns the gate.
 */
export function DataSourcePage({
  listSources, importSpreadsheet, importSample, commit, createAdvanced,
  cancel, onCommitted, onAdvanced, currentBlankSessionId, currentBound, workspaceId,
  sqlite3Missing, t,
}: DataSourcePageProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [sources, setSources] = useState<readonly ListedSource[]>([])
  const [preview, setPreview] = useState<ListedPreview | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [templateOffer, setTemplateOffer] = useState<AskDataTemplateOffer | undefined>()
  const [pickedId, setPickedId] = useState<string | undefined>()
  const replaceId = useRef<string | undefined>(undefined)

  const reload = (signal?: AbortSignal): void => {
    void listSources(signal).then((result) => {
      if (signal?.aborted) return
      if (result.ok) setSources(result.value)
    })
  }

  useEffect(() => {
    const controller = new AbortController()
    reload(controller.signal)
    return () => { controller.abort() }
  }, [])

  const fail = (result: Extract<RemoteResult<unknown>, { ok: false }>): void => {
    setError(`${result.error.message} ${t('failureLimits')}`)
  }

  const run = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await task()
    } finally {
      setBusy(false)
    }
  }

  const showPreview = (result: RemoteResult<ListedPreview>): void => {
    if (!result.ok) {
      fail(result)
      return
    }
    setPreview(result.value)
    setPickedId(result.value.source.id)
    reload()
  }

  const startWith = (sourceId: string): void => {
    if (currentBound?.sourceId === sourceId) {
      onCommitted(currentBound.sessionId)
      return
    }
    void run(async () => {
      const result = await commit({
        sourceId,
        ...currentBlankSessionId === undefined ? {} : { sessionId: currentBlankSessionId },
        ...workspaceId === undefined ? {} : { workspaceId },
      })
      if (!result.ok) {
        fail(result)
        return
      }
      onCommitted(result.value.sessionId)
    })
  }

  const previewId = preview?.source.id
  const recent = [...sources]
    .filter((row): row is ListedSource & { lastUsedAt: string } =>
      row.lastUsedAt !== undefined && row.id !== previewId)
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
  const recentIds = new Set(recent.map(row => row.id))
  const rest = sources.filter(row => !recentIds.has(row.id) && row.id !== previewId)
  const listed = [...recent, ...rest]
  const selectedId = resolveSelectedId(pickedId, preview, listed)

  const selectRow = (row: ListedSource): void => {
    if (row.missing) return
    setPickedId(row.id)
    if (preview !== undefined && preview.source.id !== row.id) setPreview(undefined)
  }

  return (
    <div className={css.page}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.lead}>{t('pageLead')}</p>
      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('pitfallsTitle')}</h3>
        <ul className={css.pitfalls}>
          {PITFALL_KEYS.map(key => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
        <p className={css.helper}>{t('templateHint')}</p>
      </section>
      <p className={css.helper}>{t('uploadHelper')}</p>
      {sqlite3Missing === true && <p className={css.error}>{t('sqlite3Missing')}</p>}
      <div className={css.actions}>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            void run(async () => { showPreview(await importSample()) })
          }}
        >
          {t('sample')}
        </Button>
        <Button
          variant="outline"
          disabled={busy || sqlite3Missing === true}
          onClick={() => { inputRef.current?.click() }}
        >
          {t('upload')}
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            void run(async () => {
              setTemplateOffer(await offerAskDataTemplate())
            })
          }}
        >
          {t('downloadTemplate')}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            void run(async () => {
              const result = await createAdvanced({
                ...workspaceId === undefined ? {} : { workspaceId },
              })
              if (!result.ok) {
                fail(result)
                return
              }
              onAdvanced(result.value.sessionId)
            })
          }}
        >
          {t('advanced')}
        </Button>
        <Button disabled={busy} onClick={() => { void cancel() }}>{t('cancel')}</Button>
      </div>
      <p className={css.helper}>{t('advancedHint')}</p>
      {templateOffer === 'saved' ? <p className={css.helper}>{t('templateSaved')}</p> : null}
      {templateOffer === 'copied' ? <p className={css.helper}>{t('templateCopied')}</p> : null}
      {templateOffer === 'shown' ? (
        <div className={css.section}>
          <p className={css.helper}>{t('templateCopyFallback')}</p>
          <textarea
            className={css.templateBody}
            readOnly
            value={ASK_DATA_TEMPLATE_CSV.replace(/^\uFEFF/, '')}
          />
        </div>
      ) : null}
      <input
        ref={inputRef}
        className={css.hiddenInput}
        type="file"
        accept=".xlsx,.csv"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file === undefined) return
          void run(async () => {
            const bytes = encodeAskDataBytes(await readFileBytes(file))
            showPreview(await importSpreadsheet({
              filename: file.name,
              bytes,
              ...replaceId.current === undefined ? {} : { replaceSourceId: replaceId.current },
            }))
            replaceId.current = undefined
          })
        }}
      />
      {preview !== undefined && (
        <PreviewPanel
          tables={preview.tables}
          warnings={preview.warnings}
          t={t}
          warningText={id => t(WARNING_KEYS[id] ?? 'failureLimits')}
        />
      )}
      {error !== undefined && (
        <div className={css.section}>
          <p className={css.error}>{error}</p>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              void run(async () => { showPreview(await importSample()) })
            }}
          >
            {t('useSample')}
          </Button>
        </div>
      )}
      {listed.length > 0 && selectedId === undefined && (
        <p className={css.helper}>{t('pickHint')}</p>
      )}
      {recent.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('recent')}</h3>
          {recent.map(row => (
            <SourceRow
              key={`recent-${row.id}`}
              row={row}
              selected={row.id === selectedId}
              t={t}
              onSelect={() => { selectRow(row) }}
              onReselect={() => {
                replaceId.current = row.id
                inputRef.current?.click()
              }}
            />
          ))}
        </section>
      )}
      {rest.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('allSources')}</h3>
          {rest.map(row => (
            <SourceRow
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              t={t}
              onSelect={() => { selectRow(row) }}
              onReselect={() => {
                replaceId.current = row.id
                inputRef.current?.click()
              }}
            />
          ))}
        </section>
      )}
      {selectedId !== undefined && (
        <div className={css.footer}>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => { startWith(selectedId) }}
          >
            {t('start')}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * The source the single start control will commit, after an explicit pick or import.
 * @param pickedId - last clicked or imported source id.
 * @param preview - open import preview, if any.
 * @param listed - rows still shown in the lists.
 * @returns a startable source id, or undefined before the user picks.
 */
function resolveSelectedId(
  pickedId: string | undefined,
  preview: ListedPreview | undefined,
  listed: readonly ListedSource[],
): string | undefined {
  if (pickedId === undefined) return undefined
  if (preview?.source.id === pickedId) return pickedId
  const row = listed.find(item => item.id === pickedId)
  if (row !== undefined && !row.missing) return pickedId
  return undefined
}

function SourceRow({
  row, selected, t, onSelect, onReselect,
}: {
  row: ListedSource
  selected: boolean
  t: (key: AskDataKey) => string
  onSelect: () => void
  onReselect: () => void
}) {
  return (
    <div className={selected ? `${css.row} ${css.rowSelected}` : css.row}>
      {row.missing
        ? (
          <span className={css.missing}>
            {row.displayName}
            {` · ${t('missing')}`}
          </span>
        )
        : (
          <button
            type="button"
            className={css.rowPick}
            aria-pressed={selected}
            onClick={onSelect}
          >
            {row.displayName}
          </button>
        )}
      {row.missing
        ? <Button size="sm" onClick={onReselect}>{t('reselect')}</Button>
        : null}
    </div>
  )
}
