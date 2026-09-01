/**
 * Pure types of the ask-knowledge domain: the one home of
 * `ask-knowledge/bound` / `ask-knowledge/unbound` and the
 * `askKnowledgeBinding` projection-key declaration, free of this
 * package's host-side value imports.
 * @module @deepseek-ai/dsh-host-ask-knowledge/types
 */

/** Fields recorded when a Session is bound to one knowledge library. */
export interface AskKnowledgeBinding {
  readonly libraryId: string
  readonly displayName: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The Session was bound to one ask-knowledge library.
     * Reconstruction of the Client list uses the `askKnowledgeBinding` projection.
     */
    'ask-knowledge/bound': AskKnowledgeBinding
    /**
     * The Session was unbound from its ask-knowledge library.
     */
    'ask-knowledge/unbound': { readonly libraryId: string }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host fold of the latest ask-knowledge bind, or null before one. */
    askKnowledgeBinding: AskKnowledgeBinding | null
  }
  interface SessionProjectionMap {
    /** Client-visible bind, mirrored from the host fold. */
    askKnowledgeBinding: AskKnowledgeBinding | null
  }
}
