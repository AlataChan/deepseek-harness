/** Clip join order, silent clips, and narration length rules. */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { composeAudiovisual, parseProbe } from '../src/compositor.ts'
import { MediaError } from '../src/error.ts'

const encoders = ' V..... h264_videotoolbox\n A..... aac\n V..... mpeg4\n'

function videoProbe(duration: string, extras: { audio?: boolean; width?: number; height?: number } = {}) {
  const streams: object[] = [{
    codec_type: 'video',
    width: extras.width ?? 640,
    height: extras.height ?? 360,
    duration,
  }]
  if (extras.audio !== false) streams.push({ codec_type: 'audio', duration })
  return JSON.stringify({ format: { duration }, streams })
}

function audioProbe(duration: string) {
  return JSON.stringify({
    format: { duration },
    streams: [{ codec_type: 'audio', duration }],
  })
}

async function touch(root: string, name: string): Promise<string> {
  const path = join(root, name)
  await writeFile(path, name)
  return path
}

async function setupFiles(): Promise<{
  root: string
  first: string
  second: string
  silent: string
  narrShort: string
  narrLong: string
  output: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'desktop-media-compose-'))
  return {
    root,
    first: await touch(root, 'first.mp4'),
    second: await touch(root, 'second.mp4'),
    silent: await touch(root, 'silent.mp4'),
    narrShort: await touch(root, 'narr-short.m4a'),
    narrLong: await touch(root, 'narr-long.m4a'),
    output: join(root, 'out.mp4'),
  }
}

function runner(probes: Record<string, string>, capture: string[][] = []): NativeCommandRunner {
  return async (command, args) => {
    capture.push([command, ...args])
    if (args.includes('-encoders')) return { stdout: encoders, stderr: '' }
    if (args.includes('-print_format')) {
      const path = args[args.length - 1]!
      const stdout = probes[path]
      if (stdout === undefined) throw new Error(`unexpected probe ${path}`)
      return { stdout, stderr: '' }
    }
    return { stdout: '', stderr: '' }
  }
}

describe('parseProbe', () => {
  it('reads duration, dimensions, and audio', () => {
    expect(parseProbe(videoProbe('1.5'))).toEqual({
      durationSeconds: 1.5,
      width: 640,
      height: 360,
      hasAudio: true,
    })
    expect(parseProbe(videoProbe('2', { audio: false })).hasAudio).toBe(false)
    expect(parseProbe(JSON.stringify({
      streams: [{ codec_type: 'video', width: 640, height: 360, duration: '2' }],
    })).durationSeconds).toBe(2)
  })

  it('rejects invalid JSON, missing video, and unusable dimensions or duration', () => {
    expect(() => parseProbe('not-json')).toThrow(MediaError)
    expect(() => parseProbe(JSON.stringify({ streams: [{ codec_type: 'audio' }] }))).toThrow(MediaError)
    expect(() => parseProbe(JSON.stringify({
      format: { duration: '1' },
      streams: [{ codec_type: 'video' }],
    }))).toThrow(MediaError)
    expect(() => parseProbe(JSON.stringify({
      streams: [{ codec_type: 'video', width: 640, height: 360 }],
    }))).toThrow(MediaError)
  })
})

describe('composeAudiovisual', () => {
  it('joins clips in the approved identifier order and pads silent audio', async () => {
    const files = await setupFiles()
    const calls: string[][] = []
    const result = await composeAudiovisual({
      clips: [
        { id: 'second', path: files.second },
        { id: 'silent', path: files.silent },
      ],
      outputPath: files.output,
      videoEncoder: 'h264_videotoolbox',
      audioEncoder: 'aac',
      binaries: { ffmpeg: '/runtime/bin/ffmpeg', ffprobe: '/runtime/bin/ffprobe' },
      signal: new AbortController().signal,
      run: runner({
        [files.second]: videoProbe('1'),
        [files.silent]: videoProbe('1', { audio: false }),
      }, calls),
    })
    expect(result.clipIds).toEqual(['second', 'silent'])
    expect(result.durationSeconds).toBe(2)
    const encode = calls.find(call => call[0] === '/runtime/bin/ffmpeg' && call.includes('-filter_complex'))!
    const inputOrder = encode.filter((arg, index, list) => list[index - 1] === '-i')
    expect(inputOrder).toEqual([files.second, files.silent])
    const graph = encode[encode.indexOf('-filter_complex') + 1]!
    expect(graph).toContain('anullsrc=')
    expect(graph).toContain('concat=n=2:v=1:a=1')
  })

  it('replaces original audio with short narration and pads silence', async () => {
    const files = await setupFiles()
    const calls: string[][] = []
    await composeAudiovisual({
      clips: [{ id: 'first', path: files.first }],
      narration: { path: files.narrShort },
      outputPath: files.output,
      binaries: { ffmpeg: '/runtime/bin/ffmpeg', ffprobe: '/runtime/bin/ffprobe' },
      signal: new AbortController().signal,
      run: runner({
        [files.first]: videoProbe('2'),
        [files.narrShort]: audioProbe('0.5'),
      }, calls),
    })
    const graph = calls.find(call => call.includes('-filter_complex'))!
      [calls.find(call => call.includes('-filter_complex'))!.indexOf('-filter_complex') + 1]!
    expect(graph).toContain('apad=whole_dur=2')
    expect(graph).toContain('concat=n=1:v=1:a=0')
    expect(graph).not.toContain('amix=')
    expect(graph).not.toContain('[acat]')
    expect(calls.at(-1)).toContain('[narr]')
  })

  it('mixes narration only when requested', async () => {
    const files = await setupFiles()
    const calls: string[][] = []
    await composeAudiovisual({
      clips: [{ id: 'first', path: files.first }],
      narration: { path: files.narrShort },
      mixOriginalAudio: true,
      outputPath: files.output,
      binaries: { ffmpeg: '/runtime/bin/ffmpeg', ffprobe: '/runtime/bin/ffprobe' },
      signal: new AbortController().signal,
      run: runner({
        [files.first]: videoProbe('2'),
        [files.narrShort]: audioProbe('0.5'),
      }, calls),
    })
    const graph = calls.find(call => call.includes('-filter_complex'))!
      [calls.find(call => call.includes('-filter_complex'))!.indexOf('-filter_complex') + 1]!
    expect(graph).toContain('concat=n=1:v=1:a=1')
    expect(graph).toContain('amix=inputs=2:duration=first')
  })

  it('rejects narration longer than the joined video', async () => {
    const files = await setupFiles()
    await expect(composeAudiovisual({
      clips: [{ id: 'first', path: files.first }],
      narration: { path: files.narrLong },
      outputPath: files.output,
      binaries: { ffmpeg: '/runtime/bin/ffmpeg', ffprobe: '/runtime/bin/ffprobe' },
      signal: new AbortController().signal,
      run: runner({
        [files.first]: videoProbe('1'),
        [files.narrLong]: audioProbe('3'),
      }),
    })).rejects.toMatchObject({ code: 'narration-too-long' })
  })

  it('rounds odd dimensions and fails on empty clips, relative paths, and missing files', async () => {
    const files = await setupFiles()
    const calls: string[][] = []
    await composeAudiovisual({
      clips: [{ id: 'first', path: files.first }],
      outputPath: files.output,
      binaries: { ffmpeg: '/runtime/bin/ffmpeg', ffprobe: '/runtime/bin/ffprobe' },
      signal: new AbortController().signal,
      run: runner({
        [files.first]: videoProbe('1', { width: 641, height: 359 }),
      }, calls),
    })
    expect(calls.find(call => call.includes('-filter_complex'))?.join(' ')).toContain('pad=642:360')

    await expect(composeAudiovisual({
      clips: [],
      outputPath: files.output,
      binaries: { ffmpeg: '/runtime/bin/ffmpeg', ffprobe: '/runtime/bin/ffprobe' },
      signal: new AbortController().signal,
      run: runner({}),
    })).rejects.toMatchObject({ code: 'clips-empty' })

    await expect(composeAudiovisual({
      clips: [{ id: 'rel', path: 'relative.mp4' }],
      outputPath: files.output,
      binaries: { ffmpeg: '/runtime/bin/ffmpeg', ffprobe: '/runtime/bin/ffprobe' },
      signal: new AbortController().signal,
      run: runner({}),
    })).rejects.toMatchObject({ code: 'path-not-absolute' })

    await expect(composeAudiovisual({
      clips: [{ id: 'missing', path: join(files.root, 'nope.mp4') }],
      outputPath: files.output,
      binaries: { ffmpeg: '/runtime/bin/ffmpeg', ffprobe: '/runtime/bin/ffprobe' },
      signal: new AbortController().signal,
      run: runner({}),
    })).rejects.toMatchObject({ code: 'input-missing' })

    await expect(composeAudiovisual({
      clips: [{ id: 'first', path: files.first }],
      outputPath: 'out.mp4',
      binaries: { ffmpeg: '/runtime/bin/ffmpeg', ffprobe: '/runtime/bin/ffprobe' },
      signal: new AbortController().signal,
      run: runner({}),
    })).rejects.toMatchObject({ code: 'path-not-absolute' })
  })

  it('rejects a missing encoder and invalid narration probes', async () => {
    const files = await setupFiles()
    await expect(composeAudiovisual({
      clips: [{ id: 'first', path: files.first }],
      outputPath: files.output,
      videoEncoder: 'libx264',
      binaries: { ffmpeg: '/runtime/bin/ffmpeg', ffprobe: '/runtime/bin/ffprobe' },
      signal: new AbortController().signal,
      run: runner({ [files.first]: videoProbe('1') }),
    })).rejects.toMatchObject({ code: 'encoder-missing' })

    await expect(composeAudiovisual({
      clips: [{ id: 'first', path: files.first }],
      narration: { path: files.narrShort },
      outputPath: files.output,
      binaries: { ffmpeg: '/runtime/bin/ffmpeg', ffprobe: '/runtime/bin/ffprobe' },
      signal: new AbortController().signal,
      run: runner({
        [files.first]: videoProbe('1'),
        [files.narrShort]: 'not-json',
      }),
    })).rejects.toMatchObject({ code: 'probe-invalid' })

    await expect(composeAudiovisual({
      clips: [{ id: 'first', path: files.first }],
      narration: { path: files.narrShort },
      outputPath: files.output,
      binaries: { ffmpeg: '/runtime/bin/ffmpeg', ffprobe: '/runtime/bin/ffprobe' },
      signal: new AbortController().signal,
      run: runner({
        [files.first]: videoProbe('1'),
        [files.narrShort]: JSON.stringify({ streams: [{ codec_type: 'video', width: 2, height: 2 }] }),
      }),
    })).rejects.toMatchObject({ code: 'probe-invalid' })

    await expect(composeAudiovisual({
      clips: [{ id: 'first', path: files.first }],
      narration: { path: files.narrShort },
      outputPath: files.output,
      binaries: { ffmpeg: '/runtime/bin/ffmpeg', ffprobe: '/runtime/bin/ffprobe' },
      signal: new AbortController().signal,
      run: runner({
        [files.first]: videoProbe('1'),
        [files.narrShort]: JSON.stringify({ streams: [{ codec_type: 'audio' }] }),
      }),
    })).rejects.toMatchObject({ code: 'probe-invalid' })

    await composeAudiovisual({
      clips: [{ id: 'first', path: files.first }],
      narration: { path: files.narrShort },
      outputPath: files.output,
      binaries: { ffmpeg: '/runtime/bin/ffmpeg', ffprobe: '/runtime/bin/ffprobe' },
      signal: new AbortController().signal,
      run: runner({
        [files.first]: videoProbe('1'),
        [files.narrShort]: JSON.stringify({
          streams: [{ codec_type: 'audio', duration: '0.25' }],
        }),
      }),
    })
  })

  it('rejects a directory used as a clip', async () => {
    const files = await setupFiles()
    await mkdir(join(files.root, 'dir'))
    await expect(composeAudiovisual({
      clips: [{ id: 'dir', path: join(files.root, 'dir') }],
      outputPath: files.output,
      binaries: { ffmpeg: '/runtime/bin/ffmpeg', ffprobe: '/runtime/bin/ffprobe' },
      signal: new AbortController().signal,
      run: runner({}),
    })).rejects.toMatchObject({ code: 'path-not-a-file' })
  })
})
