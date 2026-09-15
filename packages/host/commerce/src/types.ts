/**
 * Commerce identity, value, change-kind, and durable binding types with their Session projection declarations.
 * This module has no Host runtime imports so Client aggregates can consume it.
 * @module @deepseek-ai/dsh-host-commerce/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Provider-managed commerce source identity. */
export type CommerceSourceId = Branded<'CommerceSourceId'>

/** Stable identity of one listing in a commerce source. */
export type ListingId = Branded<'ListingId'>

/** Stable identity of one staged commerce change. */
export type ChangeId = Branded<'ChangeId'>

/** Scalar value read from or rendered for a commerce source. */
export type CommerceValue = string | number | boolean | null

/** Staged operation families the Provider can render for platform export. */
export type CommerceChangeKind =
  | 'listing-update'
  | 'price-change'
  | 'promotion'
  | 'restock'
  | 'campaign'

/** Imported table families available in one commerce source. */
export type CommerceDataKind = 'orders' | 'products' | 'inventory'

/** Fields recorded when a Session is bound to one commerce source. */
export interface CommerceBinding {
  readonly sourceId: CommerceSourceId
  readonly displayName: string
  readonly kinds: readonly CommerceDataKind[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The Session was bound to one commerce source. Consumers reconstruct the
     * binding through the `commerceBinding` projection.
     * @param data - source identity, display name, and imported table families.
     */
    'commerce/bound': CommerceBinding
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host fold of the commerce binding, or null before binding. */
    commerceBinding: CommerceBinding | null
  }
  interface SessionProjectionMap {
    /** Client-visible commerce binding mirrored from the Host fold. */
    commerceBinding: CommerceBinding | null
  }
}
