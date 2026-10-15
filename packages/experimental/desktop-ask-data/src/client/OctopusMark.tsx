/**
 * octopus_DSH mark: the accepted product preset, independent of assistant avatars.
 * Occupies the official fish slots on the desktop overlay.
 */

import { useSyncExternalStore } from 'react'
import type { BrandPreference } from './brand-preference.ts'
import { BRAND_MARKS } from './brand-marks.ts'
import { OCTOPUS_MARK_URI } from './octopus-mark-uri.ts'

/** Shared presentation for sidebar and conversation-hero brand holes. */
export interface OctopusMarkProps {
  /** Requested square edge in pixels. */
  size: number
  /** Shared Host settings preference; omitted for standalone default rendering. */
  preference?: BrandPreference | undefined
  /** Host class preserving the surrounding mark geometry. */
  className?: string | undefined
}

const subscribeDefault = () => () => {}
const readDefault = () => undefined

/**
 * Render the fork mark at the size the host slot requested.
 * @param props - square edge and optional host class.
 * @returns the bundled whale image.
 */
export function OctopusMark({ size, className, preference }: OctopusMarkProps) {
  const state = useSyncExternalStore(preference?.subscribe ?? subscribeDefault, preference?.getSnapshot ?? readDefault)
  return (
    <img
      src={state ? BRAND_MARKS[state.id] : OCTOPUS_MARK_URI}
      data-brand-mark={state?.id ?? 'original'}
      width={size}
      height={size}
      alt=""
      className={className}
      aria-hidden="true"
      style={{ borderRadius: '25%' }}
    />
  )
}
