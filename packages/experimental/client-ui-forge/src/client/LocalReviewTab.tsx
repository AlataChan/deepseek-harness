/** The single Changes tab for local checkout controls and actual Git diffs. */
import { useEffect, useMemo, useState } from 'react'
import { Button, IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ForgeLocalDiff, ForgeLocalScope, ForgePanelState } from '../types.ts'
import type { PanelSource, PanelSnapshot } from './source.ts'
import { WorktreeProgress } from './WorktreeProgress.tsx'
import { LocalChangesCard } from './LocalChangesCard.tsx'
import { FileTreePane } from './FileTreePane.tsx'
import { DiffFile } from './DiffFile.tsx'
import { orderedFiles } from './file-tree.ts'
import css from './LocalReviewTab.module.css'
/** Local worktree decisions exposed to the one tab. */
export type LocalAction = 'requestWorktree' | 'cancelWorktree' | 'stopCreation' | 'retryWorktree' | 'restoreWorktree' | 'continueInProject'
/** Source-safe injected callbacks bound by the browser composition. */
export interface LocalReviewInjected {
  source: (sessionId: SessionId) => PanelSource
  action: (sessionId: SessionId, action: LocalAction) => Promise<void>
  readDiff: (sessionId: SessionId, scope: ForgeLocalScope, signal: AbortSignal) => Promise<ForgeLocalDiff>
}
/**
 * Render one Session's local review while its sidebar tab is visible.
 * @param props - slot lifecycle, local Remote callbacks, and localized copy.
 * @returns the local review tab.
 */
export function LocalReviewTab({ sessionId, useTabInfo, source, action, readDiff, t }: PropsRuntime<'sidebar.right.pane.tab'> & LocalReviewInjected & PropsLocale<'worktree-review'>) {
  const { tab } = useTabInfo()
  const store = useMemo(() => source(sessionId), [source, sessionId])
  const [snapshot, setSnapshot] = useState<PanelSnapshot>(() => store.hooks.panel.getSnapshot())
  const [scope, setScope] = useState<ForgeLocalScope>({ kind: 'uncommitted' })
  const [revision, setRevision] = useState(0)
  const [diff, setDiff] = useState<ForgeLocalDiff | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string>()
  useEffect(() => {
    setSnapshot(store.hooks.panel.getSnapshot())
    if (!tab.visible) return
    return store.hooks.panel.subscribe(() => { setSnapshot(store.hooks.panel.getSnapshot()) })
  }, [store, tab.visible])
  const directory = snapshot.state?.directory
  const ready = snapshot.state?.checkout.state === 'ready'
  useEffect(() => {
    setDiff(null)
    if (!tab.visible || !ready) return
    const control = new AbortController()
    setError(false)
    void readDiff(sessionId, scope, control.signal).then((value) => {
      if (control.signal.aborted) return
      setDiff(value)
      setSelected(path => value.files.some(file => file.path === path) ? path : value.files[0]?.path)
    }, () => { if (!control.signal.aborted) setError(true) })
    return () => { control.abort() }
  }, [sessionId, readDiff, scope, directory, ready, revision, tab.visible])
  const decide = async (choice: LocalAction): Promise<void> => {
    setBusy(true)
    try { await action(sessionId, choice) } finally { if (!tab.signal.aborted) setBusy(false) }
  }
  return <LocalReviewBody
    state={snapshot.state} disconnected={snapshot.disconnected} diff={diff} error={error} busy={busy}
    scope={scope.kind} onScope={(kind) => { setScope({ kind }) }} selected={selected} onSelect={setSelected}
    onAction={decide} onRefresh={() => { store.reconnect(); setRevision(value => value + 1) }} t={t}
  />
}
/** UI data and callbacks independent of the slot runtime. */
export interface LocalReviewBodyProps extends PropsLocale<'worktree-review'> {
  state: ForgePanelState | null
  disconnected: boolean
  diff: ForgeLocalDiff | null
  error: boolean
  busy: boolean
  scope: ForgeLocalScope['kind']
  onScope: (scope: ForgeLocalScope['kind']) => void
  selected: string | undefined
  onSelect: (path: string) => void
  onAction: (action: LocalAction) => Promise<void>
  onRefresh: () => void
}
/**
 * Render controls and escaped diff rows from the Host's local state.
 * @param props - local observations and explicit user actions.
 * @returns the Changes panel; mounting never requests a worktree.
 */
export function LocalReviewBody({
  state, disconnected, diff, error, busy, scope, onScope, selected, onSelect, onAction, onRefresh, t,
}: LocalReviewBodyProps) {
  const files = orderedFiles(diff?.files ?? [])
  const file = files.find(item => item.path === selected) ?? files[0]
  return <section className={css.panel} aria-label={t('title')} data-worktree-review>
    <header className={css.header}><IconBranchOutlineRegular /><span>{t('title')}</span><Button size="sm" onClick={onRefresh}>{t('refresh')}</Button></header>
    {disconnected && <p role="alert">{t('disconnected')}</p>}
    {state !== null && <>
      <p className={css.directory}>{t('current')}: {state.directory}</p>
      <div className={css.actions}>
        {state.worktree.editable && state.worktree.request === null && <Button size="sm" disabled={busy || state.worktree.blocker !== null || state.checkout.state !== 'ready'} onClick={() => { void onAction('requestWorktree') }}>{t('create')}</Button>}
        {state.worktree.editable && state.worktree.request !== null && state.worktree.creation === null && <><p>{t('requested')}</p><Button size="sm" disabled={busy} onClick={() => { void onAction('cancelWorktree') }}>{t('cancel')}</Button></>}
        {state.worktree.creation?.held === true && <Button size="sm" disabled={busy} onClick={() => { void onAction('stopCreation') }}>{t('stop')}</Button>}
        {state.worktree.waiting === 'creation' && state.worktree.creation === null && <Button size="sm" disabled={busy} onClick={() => { void onAction('retryWorktree') }}>{t('retry')}</Button>}
        {state.worktree.missing !== null && <Button size="sm" disabled={busy || state.worktree.restoration !== null} onClick={() => { void onAction('restoreWorktree') }}>{t('restore')}</Button>}
        {state.worktree.created !== null && <Button size="sm" disabled={busy || state.worktree.restoration !== null || state.worktree.creation !== null} onClick={() => { void onAction('continueInProject') }}>{t('leave')}</Button>}
      </div>
      <WorktreeProgress worktree={state.worktree} t={t} />
      {state.worktree.blocker === 'read-only' && <p>{t('readonly')}</p>}
      {state.checkout.state === 'none' && state.worktree.missing === null && <p>{t('notGit')}</p>}
    </>}
    <div className={css.scopes}>{(['uncommitted', 'staged', 'unstaged', 'branch'] as const).map(kind => <Button key={kind} size="sm" disabled={kind === 'branch' && state?.worktree.created == null} aria-pressed={scope === kind} onClick={() => { onScope(kind) }}>{t(kind)}</Button>)}</div>
    {error && <p role="alert">{t('unavailable')}</p>}
    {diff !== null && <><LocalChangesCard diff={diff} label={t('files')} /><FileTreePane files={files} selected={file?.path} onSelect={onSelect} label={t('files')} />{file === undefined ? <p>{t('empty')}</p> : <DiffFile file={file} t={t} />}{diff.omitted > 0 && <p>{t('omitted')}</p>}</>}
  </section>
}
