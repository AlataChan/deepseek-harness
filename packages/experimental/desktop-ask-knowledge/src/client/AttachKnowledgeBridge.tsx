/**
 * Invisible plus-menu occupant: opens the library picker when the composer asks.
 */

import { useEffect, useRef } from 'react'
import type { AttachKnowledgeOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Opener shared with the hero chip. */
export interface AttachKnowledgeBridgeInjected {
  /** Open the library picker. Does not occupy the ask-data gate. */
  openPicker: () => void
}

/** Plus-menu bridge props: owner request plus the shared opener. */
export interface AttachKnowledgeBridgeProps
  extends AttachKnowledgeOwnerProps, AttachKnowledgeBridgeInjected {}

/**
 * Mount reports readiness; each new `openRequest` opens the picker once.
 * @param props - plus-menu owner fields and the shared opener.
 * @returns nothing; the plus menu owns the visible row.
 */
export function AttachKnowledgeBridge({
  openRequest, onReady, openPicker,
}: AttachKnowledgeBridgeProps) {
  const seen = useRef(0)
  useEffect(() => {
    onReady(true)
    return () => { onReady(false) }
  }, [onReady])
  useEffect(() => {
    if (openRequest === 0 || openRequest === seen.current) return
    seen.current = openRequest
    openPicker()
  }, [openRequest, openPicker])
  return null
}
