/** Types owned by the commerce tool Consumer and its replay projection. */

import type { CommerceBinding, ListingId } from '@deepseek-ai/dsh-host-commerce'

/** Persisted presentation metadata emitted by commerce read tools. */
export interface CommerceToolMeta {
  readonly listingIds: readonly ListingId[]
  readonly fullListing: boolean
}

/** Internal replay state, including unresolved commerce call identities. */
export interface CommerceSessionState {
  readonly binding: CommerceBinding | null
  readonly readListingIds: readonly ListingId[]
  readonly fullReadListingIds: readonly ListingId[]
  readonly pendingCalls: Readonly<Record<string, string>>
}

/** Client-visible commerce binding and read provenance. */
export type CommerceSessionProjection = Omit<CommerceSessionState, 'pendingCalls'>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Commerce binding and listing-read provenance reconstructed from the log. */
    commerceSession: CommerceSessionState
  }
  interface SessionProjectionMap {
    /** Commerce binding and listing-read provenance exposed to session consumers. */
    commerceSession: CommerceSessionProjection
  }
}
