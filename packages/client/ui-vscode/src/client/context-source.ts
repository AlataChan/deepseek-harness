/** Explicit-only `@` source retaining immutable editor snapshots by id. */

import type { EditorContextSnapshot } from '@deepseek-ai/dsh-client-connection-vscode/protocol'
import type {
  InputTriggerSource, ReferenceCodec, ReferenceInsert,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { serializeEditorContext } from './context-serializer.ts'

/** Input-trigger source name stored on every editor-context occurrence. */
export const EDITOR_CONTEXT_SOURCE = 'ide-context'

function immutableSnapshot(snapshot: EditorContextSnapshot): EditorContextSnapshot {
  const range = snapshot.range === undefined ? undefined : Object.freeze({ ...snapshot.range })
  return Object.freeze({
    ...snapshot,
    ...(range === undefined ? {} : { range }),
  })
}

function aborted(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('editor context serialization aborted')
}

/** Registry and codec for immutable editor-context references. */
export class EditorContextSource {
  private readonly snapshots = new Map<string, EditorContextSnapshot>()

  /** Source contribution registered with the shared input-trigger service. */
  readonly source: InputTriggerSource

  constructor() {
    const codec: ReferenceCodec = {
      clipboardText: ref => `@${ref}`,
      serialize: (ref, signal) => {
        if (signal.aborted) return Promise.reject(aborted(signal))
        const snapshot = this.snapshots.get(ref)
        if (snapshot === undefined) {
          return Promise.reject(new Error(`captured editor context "${ref}" is no longer available`))
        }
        return Promise.resolve(serializeEditorContext(snapshot))
      },
    }
    this.source = {
      trigger: '@',
      name: EDITOR_CONTEXT_SOURCE,
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
      codec,
    }
  }

  /**
   * Retain a defensive immutable copy and build its draft chip projection.
   * @param snapshot - parsed extension-host capture.
   * @param label - localized compact label shown on the chip.
   * @returns the reference inserted into the conversation draft.
   */
  remember(snapshot: EditorContextSnapshot, label: string): ReferenceInsert {
    if (this.snapshots.has(snapshot.id)) throw new Error(`duplicate editor context id "${snapshot.id}"`)
    this.snapshots.set(snapshot.id, immutableSnapshot(snapshot))
    return {
      source: EDITOR_CONTEXT_SOURCE,
      ref: snapshot.id,
      label,
      clipboardText: `@${label}`,
    }
  }

  /**
   * Forget a capture whose draft insertion was refused.
   * @param id - capture identity to release.
   */
  forget(id: string): void {
    this.snapshots.delete(id)
  }

  /** Release all Webview-local captures with the owning plugin fiber. */
  dispose(): void {
    this.snapshots.clear()
  }
}
