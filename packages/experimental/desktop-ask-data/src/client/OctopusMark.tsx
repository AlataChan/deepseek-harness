/**
 * octopus_DSH leaf-whale mark: cream plate, forest-green whale, leaf tail.
 * Occupies the official fish slots on the desktop overlay.
 */

import { OCTOPUS_MARK_URI } from './octopus-mark-uri.ts'

/** Shared presentation for sidebar and conversation-hero brand holes. */
export interface OctopusMarkProps {
  /** Requested square edge in pixels. */
  size: number
  /** Host class preserving the surrounding mark geometry. */
  className?: string | undefined
}

/**
 * Render the fork mark at the size the host slot requested.
 * @param props - square edge and optional host class.
 * @returns the leaf-whale image.
 */
export function OctopusMark({ size, className }: OctopusMarkProps) {
  return (
    <img
      src={OCTOPUS_MARK_URI}
      width={size}
      height={size}
      alt=""
      className={className}
      aria-hidden="true"
    />
  )
}
