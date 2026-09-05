/** Archify post-hoc HTML preview inside the Team dock. */

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ReadHtmlPreviewResult } from '@deepseek-ai/dsh-experimental-agent-team/client'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { extractArchifyPath } from './discoverArchifyPath.ts'
import css from './TeamAction.module.css'

export { extractArchifyPath } from './discoverArchifyPath.ts'

const PATH_PREF_PREFIX = 'dsh.client.agent-team.archifyPath.'
const AUTO_RETRY_MS = 1500

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
  /** Path discovered from the lead chat (`ARCHIFY_HTML_PATH`); drives autofill + auto preview. */
  discoveredPath: string | null
  canFillPrompt: boolean
  onGenerate: () => void
  onPreviewReady?: () => void
  readHtml: (sessionId: SessionId, path: string) => Promise<RemoteResult<ReadHtmlPreviewResult>>
  openPath: (path: string) => Promise<RemoteResult<{ opened: true }>>
}

/**
 * Path field + sandboxed iframe preview; falls back to Host open-in-browser.
 * Discovered chat paths autofill and auto-load; retries briefly while generating.
 */
export function ArchifySummary({
  sessionId, copy, generating, discoveredPath, canFillPrompt, onGenerate, onPreviewReady,
  readHtml, openPath,
}: ArchifySummaryProps) {
  const [path, setPath] = useState(() => readStoredPath(sessionId))
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [resolvedPath, setResolvedPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadedPathRef = useRef<string | null>(null)
  const loadedSourceRef = useRef<string | null>(null)
  const busyRef = useRef(false)
  const onPreviewReadyRef = useRef(onPreviewReady)
  const previewEmpty = copy.previewEmpty
  const previewFailed = copy.previewFailed
  onPreviewReadyRef.current = onPreviewReady

  useEffect(() => {
    setPath(readStoredPath(sessionId))
    setBlobUrl((current) => {
      if (current !== null) URL.revokeObjectURL(current)
      return null
    })
    setResolvedPath(null)
    setError(null)
    loadedPathRef.current = null
    loadedSourceRef.current = null
  }, [sessionId])

  useEffect(() => () => {
    if (blobUrl !== null) URL.revokeObjectURL(blobUrl)
  }, [blobUrl])

  const alreadyLoaded = useCallback((source: string): boolean => (
    loadedSourceRef.current === source
    || loadedPathRef.current === source
  ), [])

  const loadTarget = useCallback(async (raw: string): Promise<boolean> => {
    const trimmed = raw.trim()
    if (trimmed === '') {
      setError(previewEmpty)
      return false
    }
    const fromMarker = extractArchifyPath(trimmed)
    const target = fromMarker ?? trimmed
    if (alreadyLoaded(target)) return true
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    setError(null)
    const result = await readHtml(sessionId, target)
    busyRef.current = false
    setBusy(false)
    if (!result.ok) {
      setError(`${previewFailed}: ${result.error.message}`)
      setBlobUrl((current) => {
        if (current !== null) URL.revokeObjectURL(current)
        return null
      })
      setResolvedPath(null)
      return false
    }
    writeStoredPath(sessionId, result.value.path)
    setPath(result.value.path)
    setResolvedPath(result.value.path)
    loadedSourceRef.current = target
    loadedPathRef.current = result.value.path
    const url = URL.createObjectURL(new Blob([result.value.html], { type: 'text/html;charset=utf-8' }))
    setBlobUrl((current) => {
      if (current !== null) URL.revokeObjectURL(current)
      return url
    })
    onPreviewReadyRef.current?.()
    return true
  }, [alreadyLoaded, previewEmpty, previewFailed, readHtml, sessionId])

  useEffect(() => {
    if (discoveredPath === null) return
    writeStoredPath(sessionId, discoveredPath)
    setPath(discoveredPath)
    if (alreadyLoaded(discoveredPath)) return
    void loadTarget(discoveredPath)
  }, [alreadyLoaded, discoveredPath, loadTarget, sessionId])

  useEffect(() => {
    if (!generating || discoveredPath === null) return
    if (alreadyLoaded(discoveredPath)) return
    const timer = window.setInterval(() => {
      if (busyRef.current || alreadyLoaded(discoveredPath)) return
      void loadTarget(discoveredPath)
    }, AUTO_RETRY_MS)
    return () => { window.clearInterval(timer) }
  }, [alreadyLoaded, generating, discoveredPath, loadTarget])

  const onPathChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = event.target.value
    setPath(next)
    writeStoredPath(sessionId, next)
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
        <button type="button" className={css.smallButton} disabled={busy} onClick={() => { void loadTarget(path) }}>
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
