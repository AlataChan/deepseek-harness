/** Shared logical-request capacity for HTTP and VS Code carriers. */

/** Default logical RPC cap: 100 MiB aggregate image data after base64 plus envelope headroom. */
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 160 * 1024 * 1024

/** Fixed JSON-envelope headroom around aggregate base64 image data. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

/** Minimal attachment service view required by the capacity invariant. */
export interface ImageCapacitySource {
  /** Return the optional attachment service used by the active composition. */
  get(name: 'attachments'): { readonly imageLimits: { readonly maxMessageImageBytes: number } } | undefined
}

/**
 * Assert that one logical request can carry the configured aggregate image limit.
 * @param source - composition exposing the optional attachment service.
 * @param maxRequestBodyBytes - resolved logical request capacity.
 */
export function assertImageBodyCapacity(
  source: ImageCapacitySource,
  maxRequestBodyBytes: number,
): void {
  const attachments = source.get('attachments')
  if (attachments === undefined) return
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `client connection request capacity (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}
