/**
 * Inspect a candidate FFmpeg build for the V1 LGPL shipping rule.
 * @module @deepseek-ai/dsh-experimental-desktop-media/runtime
 */

import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { MediaError } from './error.ts'

/** Parsed `ffmpeg -version` configuration flags that decide shippability. */
export interface FfmpegLicenseReport {
  /** Raw `configuration:` line, or empty when the banner omitted it. */
  readonly configuration: string
  /** True when the build enabled GPL. */
  readonly gpl: boolean
  /** True when the build enabled nonfree components. */
  readonly nonfree: boolean
  /** True when the build linked libx264. */
  readonly libx264: boolean
  /** True when the build is LGPL-compatible under the V1 shipping rule. */
  readonly shippable: boolean
}

/** Default V1 encoders. A missing encoder is a hard failure, not a fallback. */
export const DEFAULT_VIDEO_ENCODER = 'h264_videotoolbox'
/** Native FFmpeg AAC encoder name. */
export const DEFAULT_AUDIO_ENCODER = 'aac'

/**
 * Parse one `ffmpeg -version` banner.
 * @param versionText - stdout from `ffmpeg -version`.
 * @returns license flags. Encoder names alone never make {@link FfmpegLicenseReport.shippable} true.
 */
export function inspectFfmpegVersionOutput(versionText: string): FfmpegLicenseReport {
  const configuration = /configuration:\s*(.*)/.exec(versionText)?.[1] ?? ''
  const gpl = /(?:^|\s)--enable-gpl(?:\s|$)/.test(configuration)
  const nonfree = /(?:^|\s)--enable-nonfree(?:\s|$)/.test(configuration)
  const libx264 = /(?:^|\s)--enable-libx264(?:\s|$)/.test(configuration)
  return {
    configuration,
    gpl,
    nonfree,
    libx264,
    shippable: configuration !== '' && !gpl && !nonfree && !libx264,
  }
}

/**
 * Read and parse `ffmpeg -version`.
 * @param ffmpegPath - absolute ffmpeg executable.
 * @param signal - caller lifetime.
 * @param run - injectable command runner.
 * @returns license report for that binary.
 */
export async function inspectFfmpegLicense(
  ffmpegPath: string,
  signal: AbortSignal,
  run: NativeCommandRunner = runNativeCommand,
): Promise<FfmpegLicenseReport> {
  const { stdout } = await run(ffmpegPath, ['-version'], signal, 'hidden')
  return inspectFfmpegVersionOutput(stdout)
}

/**
 * Reject a runtime that is not LGPL-compatible under the V1 shipping rule.
 * @param report - parsed license flags.
 * @throws {@link MediaError} `license-unverified` when the build is not shippable.
 */
export function assertShippableFfmpeg(report: FfmpegLicenseReport): void {
  if (report.shippable) return
  throw new MediaError(
    'license-unverified',
    'FFmpeg is not an LGPL-compatible runtime; GPL, nonfree, or libx264 builds cannot ship',
  )
}

/**
 * Confirm named encoders appear in `ffmpeg -encoders`.
 * @param ffmpegPath - absolute ffmpeg executable.
 * @param encoders - encoder names that composition will request.
 * @param signal - caller lifetime.
 * @param run - injectable command runner.
 */
export async function assertEncodersAvailable(
  ffmpegPath: string,
  encoders: readonly string[],
  signal: AbortSignal,
  run: NativeCommandRunner = runNativeCommand,
): Promise<void> {
  const { stdout } = await run(ffmpegPath, ['-hide_banner', '-encoders'], signal, 'hidden')
  for (const name of encoders) {
    const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(name)}(?:\\s|$)`, 'm')
    if (!pattern.test(stdout)) {
      throw new MediaError(
        'encoder-missing',
        `media runtime is missing encoder ${name}`,
      )
    }
  }
}

/**
 * Escape one encoder name for a word-boundary search.
 * @param value - literal encoder name.
 * @returns regex-escaped name.
 */
/**
 * Confirm a user-owned runtime exists and exposes the V1 encoders.
 * Does not apply {@link assertShippableFfmpeg}.
 * @param ffmpegPath - absolute ffmpeg executable.
 * @param signal - caller lifetime.
 * @param run - injectable command runner.
 */
export async function assertUserRuntimeReady(
  ffmpegPath: string,
  signal: AbortSignal,
  run: NativeCommandRunner = runNativeCommand,
): Promise<void> {
  await assertEncodersAvailable(
    ffmpegPath,
    [DEFAULT_VIDEO_ENCODER, DEFAULT_AUDIO_ENCODER],
    signal,
    run,
  )
}

/**
 * Escape one encoder name for a word-boundary search.
 * @param value - literal encoder name.
 * @returns regex-escaped name.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
