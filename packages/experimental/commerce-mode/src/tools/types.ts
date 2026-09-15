/** Types owned by the commerce tool Consumer and its replay projection. */

import type {
  ChangeId,
  CommerceBinding,
  CommerceChangeKind,
  CommerceValue,
  ListingId,
} from '@deepseek-ai/dsh-host-commerce/types'

/** One line of a staged change; `listingId` is null for a campaign-level field. */
export interface StagedChangeItem {
  readonly listingId: ListingId | null
  readonly field: string
  readonly before: CommerceValue
  readonly after: CommerceValue
}

/** Lifecycle of one change in the session ledger. */
export type StagedChangeStatus = 'staged' | 'discarded' | 'exported'

/** One grounded change recorded for review and approved export. */
export interface StagedChange {
  readonly id: ChangeId
  readonly kind: CommerceChangeKind
  /** Display text shortened to a fixed length. */
  readonly summary: string
  readonly items: readonly StagedChangeItem[]
  readonly status: StagedChangeStatus
  /** Inclusive promotion or campaign dates. */
  readonly window?: { readonly startsOn: string; readonly endsOn: string } | undefined
  /** Campaign name and targeted listings. */
  readonly campaign?: { readonly name: string; readonly listingIds: readonly ListingId[] } | undefined
}

/** Persisted presentation metadata emitted by commerce tools. */
export interface CommerceToolMeta {
  readonly listingIds: readonly ListingId[]
  readonly fullListing: boolean
  /** Change recorded by a staging tool. */
  readonly staged?: StagedChange | undefined
  /** Change a discard call moved out of the staged state. */
  readonly discardedChangeId?: ChangeId | undefined
  /** Changes an approved export wrote. */
  readonly exportedChangeIds?: readonly ChangeId[] | undefined
  /** Workspace-relative path of the written export file. */
  readonly exportPath?: string | undefined
}

/** Internal replay state, including unresolved commerce call identities. */
export interface CommerceSessionState {
  readonly binding: CommerceBinding | null
  readonly readListingIds: readonly ListingId[]
  readonly fullReadListingIds: readonly ListingId[]
  /** Every change staged in this session, in staging order, including discarded and exported ones. */
  readonly ledger: readonly StagedChange[]
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
