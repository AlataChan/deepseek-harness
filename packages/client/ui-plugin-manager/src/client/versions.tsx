/** User-requested version checks, selection, confirmation and update outcomes on the existing plugin page. */
import type { ReactNode } from 'react'
import { Button, Modal, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PackageView, UpdateState, VersionCheck } from './manager-store.ts'
import { installable } from './manager-store.ts'
import { managementText, type Translate } from './presentation.ts'
import css from './PluginManagerPage.module.css'

/**
 * List newer versions only after the person asks, retaining refusal and compatibility details.
 * @param props - Current package, check and user actions.
 * @returns The Versions section; locked packages have no section.
 */
export function VersionSection({ pkg, check, t, busy, onCheck, onUpdate }: {
  readonly pkg: PackageView
  readonly check: VersionCheck | undefined
  readonly t: Translate
  readonly busy: boolean
  readonly onCheck: () => void
  readonly onUpdate: (version: string) => void
}): ReactNode {
  if (!pkg.updatable) return null
  const list = check?.phase === 'done' ? check.list : undefined
  return (
    <section className={css.detailSection} data-plugin-versions>
      <div className={css.versionsHead}>
        <h4 className={css.sectionTitle}>{t('versionsTitle')}</h4>
        <Button variant="outline" size="sm" disabled={busy || check?.phase === 'checking'} onClick={onCheck}>{t('versionsCheck')}</Button>
      </div>
      {check?.phase === 'checking' ? <StateDot state="ongoing" /> : null}
      {list?.status === 'refused' ? <p className={css.reason} role="status">{t('versionsCheckFailed')} {list.reason}</p> : null}
      {list?.status === 'listed' ? (
        <>
          {list.versions.length === 0 ? <p role="status">{t('versionsLatest')}</p> : null}
          <ul className={css.versionRows}>
            {list.versions.map(version => (
              <li key={version.version} className={css.versionRow} data-plugin-version={version.version}>
                <div className={css.versionFacts}>
                  <span>{version.version}</span>
                  {version.tags.map(tag => <Tag key={tag} tone="outline">{tag}</Tag>)}
                  {version.prerelease ? <Tag tone="outline">{t('versionsPrerelease')}</Tag> : null}
                  {version.publishedAt === undefined ? null : <span>{version.publishedAt}</span>}
                  {version.deprecated === undefined ? null : <span>{version.deprecated}</span>}
                  {version.bundle ? null : <span>{t('versionsNotBundle')}</span>}
                  {version.incompatible === undefined ? null : <span>{managementText({ code: 'incompatible-version', incompatible: [version.incompatible] }, t)}</span>}
                </div>
                <Button variant="outline" size="sm" disabled={busy || !installable(version)}
                  aria-label={t('versionsSelect', { version: version.version })} onClick={() => { onUpdate(version.version) }}>
                  {t('versionsSelect', { version: version.version })}
                </Button>
              </li>
            ))}
          </ul>
          {list.omitted > 0 ? <p>{t('versionsOmitted', { count: String(list.omitted) })}</p> : null}
        </>
      ) : null}
    </section>
  )
}

/**
 * Confirm a selected update and retain Host progress, rollback and uncertain transport outcomes.
 * @param props - One update, localized copy and explicit confirmation/dismissal actions.
 * @returns The update dialog, or no dialog before selection.
 */
export function UpdateDialog({ update, t, onConfirm, onClose }: {
  readonly update: UpdateState | null
  readonly t: Translate
  readonly onConfirm: () => void
  readonly onClose: () => void
}): ReactNode {
  if (update === null) return null
  const running = update.phase === 'running'
  const result = update.result
  const outcome = result?.result
  const diagnostic = outcome?.error === undefined ? undefined : managementText(outcome.error, t)
  return (
    <Modal open title={t('versionsUpdateTitle', { name: update.packageName })} closeLabel={t('close')}
      onClose={() => { if (!running) onClose() }}
      description={t('versionsUpdateDescription', { from: update.from, to: update.to })}
      footer={(
        <>
          <Button variant="outline" disabled={running} onClick={onClose}>{t(update.phase === 'confirm' ? 'cancel' : 'close')}</Button>
          {update.phase === 'confirm' ? <Button variant="primary" onClick={onConfirm}>{t('versionsConfirm')}</Button> : null}
        </>
      )}>
      <div className={css.versionOutcome} role="status">
        {running ? <StateDot state="ongoing" /> : null}
        {update.steps.map(step => <p key={step}>{t(({ checking: 'versionsChecking', removing: 'versionsRemoving', installing: 'versionsInstalling', restoring: 'versionsRestoring' } as const)[step])}</p>)}
        {update.lost === undefined ? null : <p>{t('versionsUnknown')} {update.lost}</p>}
        {outcome === undefined ? null : <p>{t(outcome.application === 'restart-required' ? 'restartNotice'
          : outcome.application === 'failed' ? 'versionsUpdateFailed' : outcome.application === 'cancelled' ? 'versionsCancelled' : 'versionsUpdated')}</p>}
        {diagnostic === undefined ? null : <p>{diagnostic}</p>}
        {result?.restore === undefined ? null : <p>{t(result.restore.application === 'failed' || result.restore.application === 'cancelled' ? 'versionsRestoreFailed'
          : result.restore.application === 'restart-required' ? 'restartNotice' : 'versionsRestored')}</p>}
        {result?.restore?.error === undefined ? null : <p>{managementText(result.restore.error, t)}</p>}
      </div>
    </Modal>
  )
}
