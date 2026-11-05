/** Local worktree progress and a root-scoped operation notice. */
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsHooks, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ForgePanelWorktree } from '../types.ts'
import css from './WorktreeProgress.module.css'
/** One transient control outcome. */
export interface ActionNotice { readonly sequence: number; readonly success: boolean }
/**
 * Show persistent creation/restoration state and failure text.
 * @param props - current worktree state and localized copy.
 * @returns the operation state, or nothing when idle.
 */
export function WorktreeProgress({ worktree, t }: { worktree: ForgePanelWorktree } & PropsLocale<'worktree-review'>) {
  const phase = worktree.creation?.phase ?? worktree.restoration?.phase
  return <div className={css.progress}>
    {phase !== undefined && <div role="status">{t(phase)}</div>}
    {worktree.failure !== null && <p role="alert">{t('failed')}: {worktree.failure.message}</p>}
    {worktree.missing !== null && <p role="status">{t('missing')}</p>}
  </div>
}
/**
 * Announce action outcomes from an overlay that outlives the tab.
 * @param props - globally owned outcome store and localized copy.
 * @returns the app-wide toast.
 */
export function WorktreeNotice({ useNotice, dismiss, t }: PropsHooks<{ notice: HostObservable<ActionNotice | null> }> & PropsLocale<'worktree-review'> & { dismiss: () => void }) {
  const notice = useNotice(value => value)
  return notice === null ? null : <Toast key={notice.sequence} text={t(notice.success ? 'actionDone' : 'actionFailed')} {...notice.success ? { tone: 'success' as const } : {}} onDone={dismiss} />
}
