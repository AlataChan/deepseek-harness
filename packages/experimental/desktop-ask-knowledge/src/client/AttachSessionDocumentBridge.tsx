/**
 * Invisible plus-menu occupant: extracts a PDF/HTML file and returns text.
 */

import { useEffect } from 'react'
import type { AttachSessionDocumentOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  extractSessionDocumentFile,
  type SessionDocumentExtractRemotes,
} from './extract-file.ts'

/** Session remotes injected into the session-document bridge. */
export interface AttachSessionDocumentBridgeInjected {
  remotes: SessionDocumentExtractRemotes
}

/** Plus-menu bridge props: owner file plus extract remotes. */
export interface AttachSessionDocumentBridgeProps
  extends AttachSessionDocumentOwnerProps, AttachSessionDocumentBridgeInjected {}

/**
 * Mount reports readiness; a non-null `file` runs extract once.
 * @param props - plus-menu owner fields and extract remotes.
 * @returns nothing; the plus menu owns the visible row.
 */
export function AttachSessionDocumentBridge({
  file, onReady, onSettled, remotes,
}: AttachSessionDocumentBridgeProps) {
  useEffect(() => {
    onReady(true)
    return () => { onReady(false) }
  }, [onReady])
  useEffect(() => {
    if (file === null) return
    let cancelled = false
    void extractSessionDocumentFile(remotes, file).then((result) => {
      if (!cancelled) onSettled(result)
    })
    return () => { cancelled = true }
  }, [file, onSettled, remotes])
  return null
}
