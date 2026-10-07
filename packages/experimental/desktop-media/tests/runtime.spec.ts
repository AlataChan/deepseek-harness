/** FFmpeg license and encoder inspection. */

import { describe, expect, it } from 'vitest'
import { MediaError } from '../src/error.ts'
import {
  assertEncodersAvailable,
  assertShippableFfmpeg,
  assertUserRuntimeReady,
  inspectFfmpegLicense,
  inspectFfmpegVersionOutput,
} from '../src/runtime.ts'

const gplBanner = [
  'ffmpeg version 8.1.2',
  'configuration: --prefix=/opt/homebrew/Cellar/ffmpeg/8.1.2 --enable-gpl --enable-libx264 --enable-videotoolbox',
].join('\n')

const lgplBanner = [
  'ffmpeg version 7.1',
  'configuration: --disable-gpl --enable-videotoolbox --enable-audiotoolbox',
].join('\n')

describe('ffmpeg license', () => {
  it('rejects GPL and libx264 builds', () => {
    const report = inspectFfmpegVersionOutput(gplBanner)
    expect(report.gpl).toBe(true)
    expect(report.libx264).toBe(true)
    expect(report.shippable).toBe(false)
    expect(() => assertShippableFfmpeg(report)).toThrow(MediaError)
  })

  it('accepts an LGPL banner without libx264 or nonfree', () => {
    const report = inspectFfmpegVersionOutput(lgplBanner)
    expect(report.shippable).toBe(true)
    expect(report.nonfree).toBe(false)
    assertShippableFfmpeg(report)
  })

  it('treats a missing configuration line as not shippable', () => {
    const report = inspectFfmpegVersionOutput('ffmpeg version 8.1.2')
    expect(report.configuration).toBe('')
    expect(report.shippable).toBe(false)
    expect(() => assertShippableFfmpeg(report)).toThrow(MediaError)
  })

  it('flags nonfree builds', () => {
    expect(inspectFfmpegVersionOutput('configuration: --enable-nonfree').shippable).toBe(false)
  })

  it('reads version text through the injected runner', async () => {
    const report = await inspectFfmpegLicense(
      '/runtime/bin/ffmpeg',
      new AbortController().signal,
      async () => ({ stdout: lgplBanner, stderr: '' }),
    )
    expect(report.shippable).toBe(true)
  })
})

describe('encoders', () => {
  it('accepts listed encoders and rejects a missing name', async () => {
    const run = async () => ({
      stdout: ' V..... h264_videotoolbox    VideoToolbox H.264\n A..... aac\n',
      stderr: '',
    })
    const signal = new AbortController().signal
    await assertEncodersAvailable('/runtime/bin/ffmpeg', ['h264_videotoolbox', 'aac'], signal, run)
    await expect(assertEncodersAvailable('/runtime/bin/ffmpeg', ['libx264'], signal, run))
      .rejects.toMatchObject({ code: 'encoder-missing' })
  })

  it('escapes encoder names that contain regex metacharacters', async () => {
    await assertEncodersAvailable(
      '/runtime/bin/ffmpeg',
      ['h264.special'],
      new AbortController().signal,
      async () => ({ stdout: ' V..... h264.special\n', stderr: '' }),
    )
  })

  it('accepts a user runtime that lists the V1 encoders', async () => {
    const signal = new AbortController().signal
    await assertUserRuntimeReady('/runtime/bin/ffmpeg', signal, async () => ({
      stdout: ' V..... h264_videotoolbox\n A..... aac\n',
      stderr: '',
    }))
    await expect(assertUserRuntimeReady('/runtime/bin/ffmpeg', signal, async () => ({
      stdout: ' V..... mpeg4\n',
      stderr: '',
    }))).rejects.toMatchObject({ code: 'encoder-missing' })
  })
})
