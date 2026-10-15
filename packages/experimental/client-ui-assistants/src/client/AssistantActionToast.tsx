/** Shell-owned feedback that survives closing an assistant management panel. */
import { useSyncExternalStore } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'

/** One localized mutation outcome and its stable presentation identity. */
export interface AssistantActionNotice {
  readonly seq: number
  readonly text: string
  readonly success: boolean
}

/** Observable notice source owned by the mounted Client plugin. */
export interface AssistantActionToastProps {
  readonly notices: {
    subscribe: (listener: () => void) => () => void
    getSnapshot: () => AssistantActionNotice | undefined
  }
  readonly dismiss: (seq: number) => void
}

/**
 * Render the latest mutation outcome independently of the management panel's lifetime.
 * @param props - localized notice source and identity-checked dismissal.
 * @returns a shared Toast when an outcome is pending.
 */
export function AssistantActionToast({ notices, dismiss }: AssistantActionToastProps) {
  const notice = useSyncExternalStore(notices.subscribe, notices.getSnapshot)
  return notice ? <Toast key={notice.seq} text={notice.text}
    {...notice.success ? { tone: 'success' as const } : {}}
    onDone={() => { dismiss(notice.seq) }} /> : null
}
