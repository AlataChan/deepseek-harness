/**
 * Pure types of the ask-data domain: the one home of `ask-data/bound` and
 * the `askDataBinding` projection-key declaration, free of this package's
 * host-side value imports (cordis, dsh-session root, ProjectionDefinition).
 * Two namespace projections serve it — `./types` for host consumers and
 * `./client` for client aggregates — with zero content duplication.
 * @module @deepseek-ai/dsh-host-ask-data/types
 */

/** Fields recorded when a Session is bound to one data source. */
export interface AskDataBinding {
  readonly sourceId: string
  readonly connectionRef: string
  readonly displayName: string
  readonly readonly: boolean
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The Session was bound to one ask-data source. Log-only: SQL tools
     * resolve the connection through data-agent `resolveForExecution(sessionId)`,
     * not this payload. Reconstruction of the Client list uses the
     * `askDataBinding` projection.
     */
    'ask-data/bound': AskDataBinding
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host fold of the latest ask-data bind, or null before one. */
    askDataBinding: AskDataBinding | null
  }
  interface SessionProjectionMap {
    /** Client-visible bind, mirrored from the host fold. */
    askDataBinding: AskDataBinding | null
  }
}
