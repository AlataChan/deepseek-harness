/** System open and reveal for Host-resolved media files. */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MediaError } from '../src/error.ts'
import {
  assertAbsoluteMediaPath,
  canOpenMediaFile,
  openMediaFile,
  revealMediaFile,
  SYSTEM_OPEN_REQUESTED,
} from '../src/local-open.ts'

async function tempFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'desktop-media-open-'))
  const path = join(root, '作品 clip.mp4')
  await writeFile(path, 'not-a-real-video')
  return path
}

describe('path admission', () => {
  it('rejects URLs and relative paths', () => {
    expect(() => assertAbsoluteMediaPath('https://example.com/a.mp4')).toThrow(MediaError)
    expect(() => assertAbsoluteMediaPath('file:///tmp/a.mp4')).toThrow(MediaError)
    expect(() => assertAbsoluteMediaPath('relative.mp4')).toThrow(MediaError)
  })

  it('pins the no-playback wording', () => {
    expect(SYSTEM_OPEN_REQUESTED).toBe('Requested the system to open the file.')
  })
})

describe('openMediaFile', () => {
  it('opens an existing absolute file through the injected opener', async () => {
    const path = await tempFile()
    const opened: string[] = []
    await openMediaFile(path, new AbortController().signal, {
      openPath: async (target) => { opened.push(target) },
    })
    expect(opened).toEqual([path])
  })

  it('delegates to the native opener when no override is provided', async () => {
    const path = await tempFile()
    const calls: string[][] = []
    await openMediaFile(path, new AbortController().signal, {
      platform: 'darwin',
      run: async (command, args) => {
        calls.push([command, ...args])
        return { stdout: '', stderr: '' }
      },
    })
    expect(calls.some(call => call[0] === 'open' && call.includes(path))).toBe(true)
  })

  it('rejects a missing file and a directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-media-open-dir-'))
    await mkdir(join(root, 'dir'))
    await expect(openMediaFile(join(root, 'missing.mp4'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'input-missing' })
    await expect(openMediaFile(join(root, 'dir'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'path-not-a-file' })
  })
})

describe('revealMediaFile', () => {
  it('uses the host platform when none is injected', async () => {
    const path = await tempFile()
    const calls: Array<readonly [string, readonly string[]]> = []
    await revealMediaFile(path, new AbortController().signal, {
      run: async (command, args) => {
        calls.push([command, args])
        return { stdout: '', stderr: '' }
      },
    })
    expect(calls.length).toBe(1)
  })

  it('uses open -R on macOS', async () => {
    const path = await tempFile()
    const calls: Array<readonly [string, readonly string[]]> = []
    await revealMediaFile(path, new AbortController().signal, {
      platform: 'darwin',
      run: async (command, args) => {
        calls.push([command, args])
        return { stdout: '', stderr: '' }
      },
    })
    expect(calls).toEqual([['open', ['-R', path]]])
  })

  it('selects the file in Explorer on Windows', async () => {
    const path = await tempFile()
    const calls: Array<readonly [string, readonly string[]]> = []
    await revealMediaFile(path, new AbortController().signal, {
      platform: 'win32',
      run: async (command, args) => {
        calls.push([command, args])
        return { stdout: '', stderr: '' }
      },
    })
    expect(calls).toEqual([['explorer.exe', [`/select,${path}`]]])
  })

  it('opens the parent directory on Linux', async () => {
    const path = await tempFile()
    const calls: Array<readonly [string, readonly string[]]> = []
    await revealMediaFile(path, new AbortController().signal, {
      platform: 'linux',
      run: async (command, args) => {
        calls.push([command, args])
        return { stdout: '', stderr: '' }
      },
    })
    expect(calls[0]?.[0]).toBe('xdg-open')
    expect(calls[0]?.[1]?.[0]).toBe(dirname(path))
  })

  it('rejects an unsupported platform', async () => {
    const path = await tempFile()
    await expect(revealMediaFile(path, new AbortController().signal, {
      platform: 'aix',
    })).rejects.toMatchObject({ code: 'open-unsupported' })
  })
})

describe('desktop availability', () => {
  it('reports a desktop on macOS and none on headless Linux', () => {
    expect(canOpenMediaFile({ platform: 'darwin' })).toBe(true)
    expect(canOpenMediaFile({ platform: 'linux', env: {} })).toBe(false)
    expect(canOpenMediaFile({ platform: 'linux', env: { DISPLAY: ':0' } })).toBe(true)
    expect(canOpenMediaFile({ platform: 'win32' })).toBe(true)
  })
})
