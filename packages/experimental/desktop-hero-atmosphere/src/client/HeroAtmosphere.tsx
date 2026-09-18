/**
 * Blank-session shallow-water plate for `conversation.atmosphere`.
 * @module @deepseek-ai/dsh-experimental-desktop-hero-atmosphere/client/HeroAtmosphere
 */

import { useEffect, useRef, useState } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './HeroAtmosphere.module.css'

/** Injected media URLs and the reduced-motion hook. */
export interface HeroAtmosphereInjected {
  /** Packaged poster URL (K0). */
  posterUrl: string
  /** Packaged drifted still URL (K1). */
  driftUrl: string
  /** Packaged loop URL. */
  videoUrl: string
  /** Renderer-bound reduced-motion snapshot. */
  hooks: {
    reducedMotion: ObservableSnapshot<boolean>
  }
}

/** Slot props for the conversation-column atmosphere plate. */
export type HeroAtmosphereProps =
  PropsRuntime<'conversation.atmosphere'>
  & InjectFace<HeroAtmosphereInjected>

/**
 * Play the baked shallow-water loop on the blank-session Hero.
 * @param props - Hero visibility, media URLs, and reduced-motion.
 * @returns the decorative plate.
 */
export function HeroAtmosphere(props: HeroAtmosphereProps) {
  const reducedMotion = props.useReducedMotion(value => value)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  const playVideo = props.hero && !reducedMotion && !failed

  useEffect(() => {
    const video = videoRef.current
    if (video === null) return
    if (!playVideo) {
      video.pause()
      return
    }
    const playback = video.play()
    void playback.catch(() => { setFailed(true) })
  }, [playVideo])

  return (
    <div
      className={css.plate}
      data-hero-atmosphere=""
      data-visible={props.hero ? 'true' : 'false'}
      data-reduced={reducedMotion ? 'true' : 'false'}
      data-failed={failed ? 'true' : 'false'}
    >
      <img className={css.poster} src={props.posterUrl} alt="" />
      {reducedMotion ? null : (
        <img className={css.drift} src={props.driftUrl} alt="" />
      )}
      {reducedMotion || failed ? null : (
        <video
          ref={videoRef}
          className={css.video}
          src={props.videoUrl}
          poster={props.posterUrl}
          muted
          loop
          playsInline
          preload="auto"
          onError={() => { setFailed(true) }}
        />
      )}
      <div className={css.veil} />
    </div>
  )
}
