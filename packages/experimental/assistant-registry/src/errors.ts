/**
 * Error classes for catalog storage, concurrent write refusal, revision conflicts, and provisioning.
 * @module @deepseek-ai/dsh-experimental-assistant-registry/errors
 */

/**
 * Thrown when another host or process already holds the exclusive kernel write lease on the catalog.
 */
export class CatalogAlreadyOwnedError extends Error {
  constructor(public readonly lockPath: string) {
    super(`Catalog is already owned by another writer (lock held at: ${lockPath})`)
    this.name = 'CatalogAlreadyOwnedError'
  }
}

/**
 * Thrown when an update or archive operation specifies an expected revision that does not match the stored entity's current revision.
 */
export class RevisionConflictError extends Error {
  constructor(
    public readonly entityKind: string,
    public readonly entityId: string,
    public readonly expectedRevision: number,
    public readonly actualRevision: number,
  ) {
    super(
      `Revision conflict on ${entityKind} '${entityId}': expected revision ${expectedRevision}, but found ${actualRevision}`,
    )
    this.name = 'RevisionConflictError'
  }
}

/**
 * Thrown when attempting to reuse an existing operation ID with a different payload.
 */
export class ProvisioningConflictError extends Error {
  constructor(
    public readonly operationId: string,
    public readonly existingFingerprint: string,
    public readonly attemptedFingerprint: string,
  ) {
    super(
      `Provisioning operation '${operationId}' already exists with a different payload fingerprint (existing: ${existingFingerprint}, attempted: ${attemptedFingerprint})`,
    )
    this.name = 'ProvisioningConflictError'
  }
}

/**
 * Thrown when resuming or querying an operation that halted in an ambiguous state requiring explicit inspection or repair.
 */
export class AmbiguousAllocationError extends Error {
  constructor(
    public readonly operationId: string,
    public readonly checkpoint: string,
    public readonly failureReason?: string  ,
  ) {
    super(
      `Provisioning operation '${operationId}' halted in an ambiguous allocation state at checkpoint '${checkpoint}' and requires repair${failureReason ? `: ${failureReason}` : ''}`,
    )
    this.name = 'AmbiguousAllocationError'
  }
}

/**
 * Thrown when scheduling a round that violates configured bounds (e.g. maxSeatsPerRound).
 */
export class RoundBoundsExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoundBoundsExceededError'
  }
}
