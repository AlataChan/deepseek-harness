/**
 * Join approved clips and optional narration through injectable FFmpeg.
 * @module @deepseek-ai/dsh-experimental-desktop-media/compositor
 */

import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { MediaError } from './error.ts'
import { assertEncodersAvailable, DEFAULT_AUDIO_ENCODER, DEFAULT_VIDEO_ENCODER } from './runtime.ts'

/** One clip in the approved identifier-array order. */
export interface ComposeClip {
  /** Stable clip identifier used only for the result order list. */
  readonly id: string
  /** Absolute Host-resolved media path. */
  readonly path: string
}

/** Optional narration audio that replaces or mixes with the joined soundtrack. */
export interface ComposeNarration {
  /** Absolute Host-resolved audio path. */
  readonly path: string
}

/** Absolute ffmpeg/ffprobe executables. */
export interface ComposeBinaries {
  /** Absolute ffmpeg path. */
  readonly ffmpeg: string
  /** Absolute ffprobe path. */
  readonly ffprobe: string
}

/** One audiovisual composition request. */
export interface ComposeRequest {
  /** Clips in the approved join order. */
  readonly clips: readonly ComposeClip[]
  /** Absolute output MP4 path. */
  readonly outputPath: string
  /** Optional narration track. */
  readonly narration?: ComposeNarration
  /** When true, mix narration with the joined clip audio. Default replaces it. */
  readonly mixOriginalAudio?: boolean
  /** Video encoder name. Default {@link DEFAULT_VIDEO_ENCODER}. */
  readonly videoEncoder?: string
  /** Audio encoder name. Default {@link DEFAULT_AUDIO_ENCODER}. */
  readonly audioEncoder?: string
  /** Runtime binaries. */
  readonly binaries: ComposeBinaries
  /** Command runner. Tests inject a fake; production passes `runNativeCommand`. */
  readonly run: NativeCommandRunner
  /** Caller lifetime; required so composition never invents a detached signal. */
  readonly signal: AbortSignal
}

/** Successful composition facts. */
export interface ComposeResult {
  /** Absolute output path. */
  readonly outputPath: string
  /** Joined video duration in seconds. */
  readonly durationSeconds: number
  /** Clip identifiers in the order actually joined. */
  readonly clipIds: readonly string[]
}

/** ffprobe facts required to build the filter graph. */
export interface MediaProbe {
  /** Duration in seconds. */
  readonly durationSeconds: number
  /** Pixel width. */
  readonly width: number
  /** Pixel height. */
  readonly height: number
  /** True when an audio stream exists. */
  readonly hasAudio: boolean
}

/**
 * Probe one media file with ffprobe.
 * @param ffprobe - absolute ffprobe path.
 * @param path - absolute media path.
 * @param signal - caller lifetime.
 * @param run - injectable command runner.
 * @returns duration, dimensions, and whether audio exists.
 */
export async function probeMedia(
  ffprobe: string,
  path: string,
  signal: AbortSignal,
  run: NativeCommandRunner,
): Promise<MediaProbe> {
  await assertExistingAbsoluteFile(path)
  const { stdout } = await run(
    ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path],
    signal,
  )
  return parseProbe(stdout)
}

/**
 * Join clips in the approved order and attach narration.
 * @param request - composition inputs and binaries.
 * @returns output path, duration, and joined clip ids.
 */
export async function composeAudiovisual(request: ComposeRequest): Promise<ComposeResult> {
  const firstClip = request.clips[0]
  if (firstClip === undefined) {
    throw new MediaError('clips-empty', 'composition requires at least one clip')
  }
  await assertExistingAbsoluteFile(request.outputPath, { allowMissing: true })
  const signal = request.signal
  const run = request.run
  const videoEncoder = request.videoEncoder ?? DEFAULT_VIDEO_ENCODER
  const audioEncoder = request.audioEncoder ?? DEFAULT_AUDIO_ENCODER
  await assertEncodersAvailable(request.binaries.ffmpeg, [videoEncoder, audioEncoder], signal, run)

  const target = await probeMedia(request.binaries.ffprobe, firstClip.path, signal, run)
  const probes: MediaProbe[] = [target]
  for (const clip of request.clips.slice(1)) {
    probes.push(await probeMedia(request.binaries.ffprobe, clip.path, signal, run))
  }
  const width = even(target.width)
  const height = even(target.height)
  const totalDuration = probes.reduce((sum, probe) => sum + probe.durationSeconds, 0)
  const keepJoinedAudio = request.narration === undefined || request.mixOriginalAudio === true

  if (request.narration !== undefined) {
    const narration = await probeAudio(
      request.binaries.ffprobe,
      request.narration.path,
      signal,
      run,
    )
    if (narration.durationSeconds > totalDuration) {
      throw new MediaError(
        'narration-too-long',
        'narration is longer than the joined video; shorten the copy or add footage',
      )
    }
  }

  const inputs: string[] = []
  for (const clip of request.clips) {
    inputs.push('-i', clip.path)
  }
  if (request.narration !== undefined) {
    inputs.push('-i', request.narration.path)
  }

  const filters: string[] = []
  for (const [index, probe] of probes.entries()) {
    filters.push(
      `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,`
      + `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p[v${index}]`,
    )
    if (keepJoinedAudio) {
      if (probe.hasAudio) {
        filters.push(`[${index}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a${index}]`)
      } else {
        filters.push(
          `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${probe.durationSeconds},`
          + `asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a${index}]`,
        )
      }
    }
  }

  if (keepJoinedAudio) {
    const concatPairs = probes.map((_, index) => `[v${index}][a${index}]`).join('')
    filters.push(`${concatPairs}concat=n=${probes.length}:v=1:a=1[vcat][acat]`)
  } else {
    // FFmpeg 8 fails closed when concat emits an unused [acat]; replace-narration maps [narr] only.
    const concatPairs = probes.map((_, index) => `[v${index}]`).join('')
    filters.push(`${concatPairs}concat=n=${probes.length}:v=1:a=0[vcat]`)
  }

  let audioMap = '[acat]'
  if (request.narration !== undefined) {
    const narrIndex = request.clips.length
    filters.push(
      `[${narrIndex}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,`
      + `apad=whole_dur=${totalDuration}[narr]`,
    )
    if (request.mixOriginalAudio === true) {
      filters.push('[acat][narr]amix=inputs=2:duration=first:dropout_transition=0[aout]')
      audioMap = '[aout]'
    } else {
      audioMap = '[narr]'
    }
  }

  await run(
    request.binaries.ffmpeg,
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      ...inputs,
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[vcat]',
      '-map',
      audioMap,
      '-c:v',
      videoEncoder,
      '-c:a',
      audioEncoder,
      request.outputPath,
    ],
    signal,
  )

  return {
    outputPath: request.outputPath,
    durationSeconds: totalDuration,
    clipIds: request.clips.map(clip => clip.id),
  }
}

/**
 * Parse ffprobe JSON into the fields composition needs.
 * @param stdout - ffprobe JSON.
 * @returns probe facts.
 */
export function parseProbe(stdout: string): MediaProbe {
  let doc: {
    format?: { duration?: string }
    streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>
  }
  try {
    doc = JSON.parse(stdout) as typeof doc
  } catch {
    throw new MediaError('probe-invalid', 'ffprobe returned invalid JSON')
  }
  const video = doc.streams?.find(stream => stream.codec_type === 'video')
  if (video === undefined) {
    throw new MediaError('probe-no-video', 'media file has no video stream')
  }
  const width = video.width
  const height = video.height
  if (width === undefined || height === undefined || width < 2 || height < 2) {
    throw new MediaError('probe-invalid', 'video stream is missing usable dimensions')
  }
  const duration = Number(doc.format?.duration ?? video.duration)
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new MediaError('probe-invalid', 'media file is missing a usable duration')
  }
  return {
    durationSeconds: duration,
    width,
    height,
    hasAudio: doc.streams?.some(stream => stream.codec_type === 'audio') === true,
  }
}

/**
 * Probe narration audio duration.
 * @param ffprobe - absolute ffprobe path.
 * @param path - absolute audio path.
 * @param signal - caller lifetime.
 * @param run - injectable command runner.
 * @returns duration in seconds.
 */
async function probeAudio(
  ffprobe: string,
  path: string,
  signal: AbortSignal,
  run: NativeCommandRunner,
): Promise<{ durationSeconds: number }> {
  await assertExistingAbsoluteFile(path)
  const { stdout } = await run(
    ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path],
    signal,
  )
  let doc: {
    format?: { duration?: string }
    streams?: Array<{ codec_type?: string; duration?: string }>
  }
  try {
    doc = JSON.parse(stdout) as typeof doc
  } catch {
    throw new MediaError('probe-invalid', 'ffprobe returned invalid JSON')
  }
  if (doc.streams?.some(stream => stream.codec_type === 'audio') !== true) {
    throw new MediaError('probe-invalid', 'narration file has no audio stream')
  }
  const audio = doc.streams.find(stream => stream.codec_type === 'audio')
  const duration = Number(doc.format?.duration ?? audio?.duration)
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new MediaError('probe-invalid', 'narration is missing a usable duration')
  }
  return { durationSeconds: duration }
}

/**
 * Require an absolute path that is a regular file, or a writable output parent.
 * @param path - candidate path.
 * @param options.allowMissing - when true, the path need not exist yet.
 */
async function assertExistingAbsoluteFile(
  path: string,
  options: { allowMissing?: boolean } = {},
): Promise<void> {
  if (!isAbsolute(path)) {
    throw new MediaError('path-not-absolute', 'composition accepts only absolute filesystem paths')
  }
  if (options.allowMissing === true) return
  let info
  try {
    info = await stat(path)
  } catch {
    throw new MediaError('input-missing', 'media file is missing')
  }
  if (!info.isFile()) {
    throw new MediaError('path-not-a-file', 'composition requires a regular file')
  }
}

/**
 * Round a dimension up to an even value for yuv420p.
 * @param value - pixel size.
 * @returns even pixel size.
 */
function even(value: number): number {
  return value % 2 === 0 ? value : value + 1
}
