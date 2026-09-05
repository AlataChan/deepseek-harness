/** Archify post-hoc HTML preview inside the Team dock. */

import { useEffect, useState, type ChangeEvent } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ReadHtmlPreviewResult } from '@deepseek-ai/dsh-experimental-agent-team/client'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import css from './TeamAction.module.css'

const PATH_PREF_PREFIX = 'dsh.client.agent-team.archifyPath.'

function pathKey(sessionId: SessionId): string {
  return `${PATH_PREF_PREFIX}${sessionId}`
}

function readStoredPath(sessionId: SessionId): string {
  try {
    return sessionStorage.getItem(pathKey(sessionId)) ?? ''
  } catch {
    return ''
  }
}

function writeStoredPath(sessionId: SessionId, path: string): void {
  try {
    if (path.trim() === '') sessionStorage.removeItem(pathKey(sessionId))
    else sessionStorage.setItem(pathKey(sessionId), path.trim())
  } catch {
    /* ignore */
  }
}

/** Extract `ARCHIFY_HTML_PATH: …` from free text (assistant reply or paste). */
export function extractArchifyPath(text: string): string | null {
  const match = /ARCHIFY_HTML_PATH:\s*(\S+)/u.exec(text)
  if (match?.[1] === undefined) return null
  return match[1].replace(/^['"]|['"]$/gu, '')
}

/** Locale strings used by the summary preview panel. */
export interface ArchifySummaryCopy {
  title: string
  hint: string
  pathPlaceholder: string
  loadPreview: string
  openBrowser: string
  previewFailed: string
  previewEmpty: string
  generating: string
  ctaAction: string
  ctaHint: string
}

export interface ArchifySummaryProps {
  sessionId: SessionId
  copy: ArchifySummaryCopy
  generating: boolean
  canFillPrompt: boolean
  onGenerate: () => void
  readHtml: (sessionId: SessionId, path: string) => Promise<RemoteResult<ReadHtmlPreviewResult>>
  openPath: (path: string) => Promise<RemoteResult<{ opened: true }>>
}

/**
 * Path field + sandboxed iframe preview; falls back to Host open-in-browser.
 */
export function ArchifySummary({
  sessionId, copy, generating, canFillPrompt, onGenerate, readHtml, openPath,
}: ArchifySummaryProps) {
  const [path, setPath] = useState(() => readStoredPath(sessionId))
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [resolvedPath, setResolvedPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPath(readStoredPath(sessionId))
    setBlobUrl((current) => {
      if (current !== null) URL.revokeObjectURL(current)
      return null
    })
    setResolvedPath(null)
    setError(null)
  }, [sessionId])

  useEffect(() => () => {
    if (blobUrl !== null) URL.revokeObjectURL(blobUrl)
  }, [blobUrl])

  const onPathChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = event.target.value
    setPath(next)
    writeStoredPath(sessionId, next)
  }

  const loadPreview = async (): Promise<void> => {
    const trimmed = path.trim()
    if (trimmed === '') {
      setError(copy.previewEmpty)
      return
    }
    const fromMarker = extractArchifyPath(trimmed)
    const target = fromMarker ?? trimmed
    setBusy(true)
    setError(null)
    const result = await readHtml(sessionId, target)
    setBusy(false)
    if (!result.ok) {
      setError(`${copy.previewFailed}: ${result.error.message}`)
      setBlobUrl((current) => {
        if (current !== null) URL.revokeObjectURL(current)
        return null
      })
      setResolvedPath(null)
      return
    }
    writeStoredPath(sessionId, result.value.path)
    setPath(result.value.path)
    setResolvedPath(result.value.path)
    const url = URL.createObjectURL(new Blob([result.value.html], { type: 'text/html;charset=utf-8' }))
    setBlobUrl((current) => {
      if (current !== null) URL.revokeObjectURL(current)
      return url
    })
  }

  const openInBrowser = async (): Promise<void> => {
    const target = (resolvedPath ?? path).trim()
    if (target === '') {
      setError(copy.previewEmpty)
      return
    }
    setBusy(true)
    setError(null)
    const result = await openPath(target)
    setBusy(false)
    if (!result.ok) {
      setError(`${copy.previewFailed}: ${result.error.message}`)
    }
  }

  return (
    <section className={css.archifySummary} data-team-archify-summary aria-label={copy.title}>
      <div className={css.opsHeader}>
        <h3>{copy.title}</h3>
      </div>
      <p className={css.hint}>{copy.hint}</p>
      <div className={css.archifyCtaActions}>
        <button
          type="button"
          className={css.smallButton}
          disabled={!canFillPrompt || generating}
          onClick={onGenerate}
        >
          {generating ? copy.generating : copy.ctaAction}
        </button>
        <span className={css.hint}>{copy.ctaHint}</span>
      </div>
      <input
        className={css.archifyPathInput}
        value={path}
        placeholder={copy.pathPlaceholder}
        onChange={onPathChange}
        aria-label={copy.pathPlaceholder}
      />
      <div className={css.archifyCtaActions}>
        <button type="button" className={css.smallButton} disabled={busy} onClick={() => { void loadPreview() }}>
          {copy.loadPreview}
        </button>
        <button type="button" className={css.smallButton} disabled={busy} onClick={() => { void openInBrowser() }}>
          {copy.openBrowser}
        </button>
      </div>
      {error !== null && <div className={css.error} role="alert">{error}</div>}
      {blobUrl !== null ? (
        <iframe
          className={css.archifyFrame}
          title={copy.title}
          sandbox="allow-scripts allow-forms allow-modals"
          src={blobUrl}
        />
      ) : (
        <div className={css.archifyFramePlaceholder}>{copy.previewEmpty}</div>
      )}
    </section>
  )
}
