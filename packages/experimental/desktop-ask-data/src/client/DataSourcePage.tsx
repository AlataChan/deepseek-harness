/**
 * Root-scope data-source gate: sample first, then upload, then advanced connect.
 */

import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { encodeAskDataBytes, readFileBytes } from './bytes.ts'
import type { AskDataKey } from './locales.ts'
import { PreviewPanel, type PreviewTable } from './PreviewPanel.tsx'
import css from './DataSourcePage.module.css'

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
  openSession: (sessionId: string) => void
  currentBlankSessionId?: string
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
  cancel, onCommitted, openSession, currentBlankSessionId, workspaceId,
  sqlite3Missing, t,
}: DataSourcePageProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [sources, setSources] = useState<readonly ListedSource[]>([])
  const [preview, setPreview] = useState<ListedPreview | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
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
    reload()
  }

  const startWith = (sourceId: string): void => {
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

  const recent = [...sources]
    .filter((row): row is ListedSource & { lastUsedAt: string } => row.lastUsedAt !== undefined)
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))

  return (
    <div className={css.page}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.lead}>{t('pageLead')}</p>
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
              openSession(result.value.sessionId)
              reload()
            })
          }}
        >
          {t('advanced')}
        </Button>
        <Button disabled={busy} onClick={() => { void cancel() }}>{t('cancel')}</Button>
      </div>
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
          busy={busy}
          onStart={() => { startWith(preview.source.id) }}
          {...preview.warnings.length === 0
            ? {}
            : { onImportAnyway: () => { startWith(preview.source.id) } }}
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
      {recent.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('recent')}</h3>
          {recent.map(row => (
            <SourceRow
              key={`recent-${row.id}`}
              row={row}
              t={t}
              onPick={() => { startWith(row.id) }}
              onReselect={() => {
                replaceId.current = row.id
                inputRef.current?.click()
              }}
            />
          ))}
        </section>
      )}
      {sources.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('allSources')}</h3>
          {sources.map(row => (
            <SourceRow
              key={row.id}
              row={row}
              t={t}
              onPick={() => { startWith(row.id) }}
              onReselect={() => {
                replaceId.current = row.id
                inputRef.current?.click()
              }}
            />
          ))}
        </section>
      )}
    </div>
  )
}

function SourceRow({
  row, t, onPick, onReselect,
}: {
  row: ListedSource
  t: (key: AskDataKey) => string
  onPick: () => void
  onReselect: () => void
}) {
  return (
    <div className={css.row}>
      <span className={row.missing ? css.missing : undefined}>
        {row.displayName}
        {row.missing ? ` · ${t('missing')}` : ''}
      </span>
      {row.missing
        ? <Button size="sm" onClick={onReselect}>{t('reselect')}</Button>
        : <Button size="sm" onClick={onPick}>{t('start')}</Button>}
    </div>
  )
}
