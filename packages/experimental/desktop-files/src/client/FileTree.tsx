/**
 * Lazy file tree rooted at the current session cwd. Listing goes through
 * injected `listEntries` (Host derives the root); files open through
 * injected `openPath`.
 */

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  SessionListEntriesValue,
  SessionWorkspaceEntry,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SidebarFilesOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  IconCodeOutline16, IconFolderClose16, IconFolderOpen16, IconRefreshOutline16, IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FilesKey } from './locales.ts'
import css from './FileTree.module.css'

/** Injected Host actions for the file tree. */
export interface FileTreeInjected {
  /** List one level of the named session's project; omit path to list cwd. */
  listEntries: (
    sessionId: SessionId,
    path?: string,
    signal?: AbortSignal,
  ) => Promise<RemoteResult<SessionListEntriesValue>>
  /** Open a file with the host OS default application. */
  openPath: (path: string) => Promise<void>
}

/** Slot props: owner geometry plus injected listing/open and the session feed. */
export type FileTreeProps = SidebarFilesOwnerProps & FileTreeInjected & {
  useSessions: SnapshotSelectorHook<SessionListState>
  t: (key: FilesKey) => string
}

type LevelState =
  | { status: 'loading' }
  | { status: 'ok'; listing: SessionListEntriesValue }
  | { status: 'error'; code: string }

/**
 * Render the session-cwd file tree, or a rail icon when the sidebar is collapsed.
 * @param props - owner geometry, injected Host actions, session feed, locale.
 * @returns the tree or the collapsed files control.
 */
export function FileTree({
  wide, expandSidebar, selectFiles, listEntries, openPath, useSessions, t,
}: FileTreeProps) {
  const current = useSessions(s => s.current)
  const cwd = useSessions((s) => {
    const id = s.current
    return id === undefined ? undefined : s.byId[id]?.cwd
  })
  const [showHidden, setShowHidden] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [levels, setLevels] = useState<Record<string, LevelState>>({})
  const generation = useRef(0)
  const inflight = useRef<AbortController | undefined>(undefined)

  const load = (sessionId: SessionId, path: string | undefined, key: string): void => {
    inflight.current?.abort()
    const controller = new AbortController()
    inflight.current = controller
    const gen = generation.current
    setLevels(currentLevels => ({ ...currentLevels, [key]: { status: 'loading' } }))
    void listEntries(sessionId, path, controller.signal).then(
      (result) => {
        if (gen !== generation.current) return
        if (!result.ok) {
          if (controller.signal.aborted) return
          setLevels(currentLevels => ({
            ...currentLevels,
            [key]: { status: 'error', code: result.error.code },
          }))
          return
        }
        setLevels(currentLevels => ({ ...currentLevels, [key]: { status: 'ok', listing: result.value } }))
      },
      (reason: unknown) => {
        if (gen !== generation.current || controller.signal.aborted) return
        const code = reason instanceof Error && 'code' in reason && typeof reason.code === 'string'
          ? reason.code
          : 'gateway/internal'
        setLevels(currentLevels => ({ ...currentLevels, [key]: { status: 'error', code } }))
      },
    )
  }

  useEffect(() => {
    generation.current += 1
    inflight.current?.abort()
    inflight.current = undefined
    setExpanded(new Set())
    setLevels({})
    if (!wide || current === undefined || cwd === undefined || cwd === '') return
    load(current, undefined, cwd)
    return () => {
      inflight.current?.abort()
      inflight.current = undefined
    }
  }, [current, cwd, listEntries, wide])

  if (!wide) {
    return (
      <button
        type="button"
        className={css.railButton}
        aria-label={t('region.files')}
        onClick={() => {
          selectFiles()
          expandSidebar()
        }}
      >
        <IconCodeOutline16 size={18} />
      </button>
    )
  }

  if (current === undefined || cwd === undefined || cwd === '') {
    return <div className={css.empty}>{t('empty.session')}</div>
  }

  const rootKey = cwd
  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('refresh')}
          onClick={() => {
            generation.current += 1
            setExpanded(new Set())
            setLevels({})
            load(current, undefined, rootKey)
          }}
        >
          <IconRefreshOutline16 size={16} />
        </button>
        <button
          type="button"
          className={css.iconButton}
          aria-pressed={showHidden}
          aria-label={t('hidden.show')}
          onClick={() => { setShowHidden(value => !value) }}
        >
          ·
        </button>
      </div>
      <div className={css.tree}>
        <LevelView
          levelKey={rootKey}
          sessionId={current}
          levels={levels}
          expanded={expanded}
          showHidden={showHidden}
          t={t}
          onToggle={(path, kind) => {
            if (kind === 'broken-symlink') return
            if (kind === 'file') {
              void openPath(path)
              return
            }
            const next = new Set(expanded)
            if (next.has(path)) {
              next.delete(path)
              setExpanded(next)
              return
            }
            next.add(path)
            setExpanded(next)
            if (levels[path] === undefined) load(current, path, path)
          }}
        />
      </div>
    </div>
  )
}

function LevelView({
  levelKey, sessionId, levels, expanded, showHidden, t, onToggle,
}: {
  levelKey: string
  sessionId: SessionId
  levels: Record<string, LevelState>
  expanded: ReadonlySet<string>
  showHidden: boolean
  t: (key: FilesKey) => string
  onToggle: (path: string, kind: SessionWorkspaceEntry['kind']) => void
}) {
  const level = levels[levelKey]
  if (level === undefined || level.status === 'loading') {
    return <div className={css.status} />
  }
  if (level.status === 'error') {
    const message = level.code === 'session/entries-outside-root' ? t('error.outside')
      : level.code === 'session/entries-unavailable' ? t('error.unavailable')
        : t('error.unreadable')
    return <div className={css.status}>{message}</div>
  }
  const visible = level.listing.entries.filter(row => showHidden || !row.hidden)
  if (visible.length === 0) return <div className={css.status}>{t('empty.directory')}</div>
  return (
    <>
      {level.listing.truncated && <div className={css.status}>{t('truncated')}</div>}
      {visible.map(row => (
        <RowView
          key={row.path}
          row={row}
          sessionId={sessionId}
          levels={levels}
          expanded={expanded}
          showHidden={showHidden}
          t={t}
          onToggle={onToggle}
        />
      ))}
    </>
  )
}

function RowView({
  row, sessionId, levels, expanded, showHidden, t, onToggle,
}: {
  row: SessionWorkspaceEntry
  sessionId: SessionId
  levels: Record<string, LevelState>
  expanded: ReadonlySet<string>
  showHidden: boolean
  t: (key: FilesKey) => string
  onToggle: (path: string, kind: SessionWorkspaceEntry['kind']) => void
}) {
  const open = expanded.has(row.path)
  return (
    <div>
      <button
        type="button"
        className={clsx(css.row, row.kind === 'broken-symlink' && css.rowBroken)}
        onClick={() => { onToggle(row.path, row.kind) }}
      >
        {row.kind === 'directory'
          ? (open ? <IconFolderOpen16 size={16} /> : <IconFolderClose16 size={16} />)
          : row.kind === 'broken-symlink'
            ? <IconWarningOutline16 size={16} />
            : <IconCodeOutline16 size={16} />}
        <span>{row.name}</span>
      </button>
      {row.kind === 'directory' && open && (
        <div className={css.children}>
          <LevelView
            levelKey={row.path}
            sessionId={sessionId}
            levels={levels}
            expanded={expanded}
            showHidden={showHidden}
            t={t}
            onToggle={onToggle}
          />
        </div>
      )}
    </div>
  )
}
