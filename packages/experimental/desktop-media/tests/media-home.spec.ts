/** Media home and runtime-path resolution. */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../src/index.ts'
import { MediaError } from '../src/error.ts'
import {
  mediaHomeDisplay,
  mediaRuntimeBinaries,
  readUserRuntimeHome,
  readUserRuntimeHomeSync,
  resolveMediaHome,
  resolveMediaRuntimeHome,
  tryResolveMediaRuntimeHome,
  USER_RUNTIME_HOME_FILE,
  writeUserRuntimeHome,
} from '../src/media-home.ts'

const previousHome = process.env.DSH_HOME

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
})

describe('media home', () => {
  it('joins media onto the resolved DSH home', () => {
    const env = { DSH_HOME: '/tmp/dsh-home' }
    expect(resolveMediaHome(env)).toBe('/tmp/dsh-home/media')
    expect(mediaHomeDisplay(env)).toBe('$DSH_HOME/media')
  })

  it('labels the default home without a machine path', () => {
    expect(mediaHomeDisplay({})).toBe('~/.dsh/media')
  })

  it('prefers an absolute mediaRuntimePath', () => {
    expect(resolveMediaRuntimeHome({ mediaRuntimePath: '/opt/media-runtime' }, {}))
      .toBe('/opt/media-runtime')
    expect(mediaRuntimeBinaries('/opt/media-runtime')).toEqual({
      ffmpeg: '/opt/media-runtime/bin/ffmpeg',
      ffprobe: '/opt/media-runtime/bin/ffprobe',
    })
  })

  it('falls through blank config to OCTOPUS_MEDIA_HOME', () => {
    expect(resolveMediaRuntimeHome({ mediaRuntimePath: '  ' }, { OCTOPUS_MEDIA_HOME: '/var/media' }))
      .toBe('/var/media')
  })

  it('rejects a relative runtime path and a missing environment home', () => {
    const isolated = { DSH_HOME: '/tmp/desktop-media-home-missing' }
    expect(() => resolveMediaRuntimeHome({ mediaRuntimePath: 'relative' }, isolated)).toThrow(MediaError)
    expect(() => resolveMediaRuntimeHome({}, isolated)).toThrow(MediaError)
    expect(() => resolveMediaRuntimeHome({}, { ...isolated, OCTOPUS_MEDIA_HOME: 'relative' })).toThrow(MediaError)
  })
})

describe('plugin load', () => {
  it('allows an empty runtime path so companion chat can start', async () => {
    const ctx = new Context()
    await ctx.plugin(plugin)
  })

  it('validates an explicit absolute runtime path at load', async () => {
    const ctx = new Context()
    await ctx.plugin(plugin, { ...plugin.Config({} as never), mediaRuntimePath: '/opt/media-runtime' })
  })

  it('fails load on a relative runtime path', () => {
    const ctx = new Context()
    try {
      plugin.apply(ctx, {
        mediaRuntimePath: 'relative',
        maxPaidCallsPerSession: 8,
        maxEstimatedSpendYuan: 40,
        maxClipCount: 4,
        maxClipDurationSeconds: 15,
        maxFileBytes: 20 * 1024 * 1024,
        pollIntervalMs: 4000,
        pollTimeoutMs: 600_000,
        videoModel: 'MiniMax-H3-Max',
        ttsModel: 'speech-2.8-hd',
        defaultDurationSeconds: 5,
        defaultResolution: '768P',
        defaultRatio: '16:9',
      })
      throw new Error('expected apply to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(MediaError)
      expect((error as MediaError).code).toBe('runtime-relative')
    }
  })
})

describe('user runtime marker', () => {
  it('writes and reads an absolute marker, and ignores blank or relative text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-media-home-'))
    const env = { DSH_HOME: root }
    expect(await readUserRuntimeHome(env)).toBeUndefined()
    expect(readUserRuntimeHomeSync(env)).toBeUndefined()
    expect(await tryResolveMediaRuntimeHome({}, env)).toBeUndefined()
    await expect(writeUserRuntimeHome('relative', env)).rejects.toThrow(MediaError)
    await writeUserRuntimeHome('/opt/user-ffmpeg', env)
    expect(await readUserRuntimeHome(env)).toBe('/opt/user-ffmpeg')
    expect(readUserRuntimeHomeSync(env)).toBe('/opt/user-ffmpeg')
    expect(await tryResolveMediaRuntimeHome({ mediaRuntimePath: '' }, env)).toBe('/opt/user-ffmpeg')
    expect(resolveMediaRuntimeHome({ mediaRuntimePath: '' }, env)).toBe('/opt/user-ffmpeg')
    expect(USER_RUNTIME_HOME_FILE).toBe('user-runtime-home')

    await writeFile(join(root, 'media', USER_RUNTIME_HOME_FILE), '  \n')
    expect(await readUserRuntimeHome(env)).toBeUndefined()
    expect(readUserRuntimeHomeSync(env)).toBeUndefined()
    await writeFile(join(root, 'media', USER_RUNTIME_HOME_FILE), 'relative')
    expect(await readUserRuntimeHome(env)).toBeUndefined()
    expect(readUserRuntimeHomeSync(env)).toBeUndefined()
    await expect(tryResolveMediaRuntimeHome({ mediaRuntimePath: 'relative' }, env))
      .rejects.toThrow(MediaError)
    expect(await tryResolveMediaRuntimeHome({ mediaRuntimePath: '/abs/runtime' }, env))
      .toBe('/abs/runtime')
    expect(await tryResolveMediaRuntimeHome({ mediaRuntimePath: '' }, {
      DSH_HOME: root,
      OCTOPUS_MEDIA_HOME: '/var/media',
    })).toBe('/var/media')
  })
})

describe('unused tmp helpers stay isolated', () => {
  it('does not write the media root during resolution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-media-home-'))
    await mkdir(join(root, 'media'), { recursive: true })
    await writeFile(join(root, 'media', 'keep.txt'), 'ok')
    expect(resolveMediaHome({ DSH_HOME: root })).toBe(join(root, 'media'))
  })
})
