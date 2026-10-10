/** Host staging of a browser-selected recording into the session workspace. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  RECORDINGS_DIRECTORY,
  TranscriptAudio,
  TranscriptAudioError,
  sanitizeRecordingName,
} from '../src/staging.ts'

vi.mock('node:fs/promises', { spy: true })

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.clearAllMocks()
})

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-transcript-audio-'))
  roots.push(root)
  return root
}

function service(maxUploadMiB = 64): TranscriptAudio {
  return new TranscriptAudio(new Context(), { maxUploadMiB })
}

describe('sanitizeRecordingName', () => {
  it('strips directory parts down to the final segment', () => {
    expect(sanitizeRecordingName('meeting.m4a')).toBe('meeting.m4a')
    expect(sanitizeRecordingName('a/b/meeting.m4a')).toBe('meeting.m4a')
    expect(sanitizeRecordingName('a\\b\\meeting.m4a')).toBe('meeting.m4a')
    expect(sanitizeRecordingName('a/meeting.m4a/')).toBe('meeting.m4a')
  })

  it.each([
    ['a traversal segment', '../secret.m4a'],
    ['a nested traversal segment', 'a/../secret.m4a'],
    ['an embedded NUL', 'meeting\0.m4a'],
    ['an empty name', ''],
  ])('refuses %s', (_label, filename) => {
    expect(() => sanitizeRecordingName(filename)).toThrow(TranscriptAudioError)
  })
})

describe('TranscriptAudio.importAudio', () => {
  it('writes bytes under recordings/ and returns the workspace-relative path', async () => {
    const root = await scratch()
    const bytes = new Uint8Array([1, 2, 3, 4])
    const staged = await service().importAudio({ filename: '访谈.m4a', bytes }, root)

    expect(staged).toEqual({ path: 'recordings/访谈.m4a', filename: '访谈.m4a' })
    await expect(readFile(join(root, RECORDINGS_DIRECTORY, '访谈.m4a'))).resolves.toEqual(Buffer.from(bytes))
  })

  it('suffixes collisions and never replaces an existing recording', async () => {
    const root = await scratch()
    await fsp.mkdir(join(root, RECORDINGS_DIRECTORY), { recursive: true })
    await writeFile(join(root, RECORDINGS_DIRECTORY, 'meeting.m4a'), 'first')

    const second = await service().importAudio({ filename: 'meeting.m4a', bytes: new Uint8Array([9]) }, root)
    expect(second).toEqual({ path: 'recordings/meeting-2.m4a', filename: 'meeting-2.m4a' })
    await expect(readFile(join(root, RECORDINGS_DIRECTORY, 'meeting.m4a'), 'utf8')).resolves.toBe('first')

    const third = await service().importAudio({ filename: 'meeting.m4a', bytes: new Uint8Array([9]) }, root)
    expect(third.filename).toBe('meeting-3.m4a')
  })

  it('accepts a recording extension in any case', async () => {
    const root = await scratch()
    const staged = await service().importAudio({ filename: '录音.M4A', bytes: new Uint8Array([5]) }, root)
    expect(staged).toEqual({ path: 'recordings/录音.M4A', filename: '录音.M4A' })
  })

  it('refuses a name that is not a recording format', async () => {
    const root = await scratch()
    await expect(service().importAudio({ filename: 'notes.txt', bytes: new Uint8Array([1]) }, root))
      .rejects.toThrow(/只支持 m4a、mp3、wav、aac/)
    await expect(service().importAudio({ filename: 'record', bytes: new Uint8Array([1]) }, root))
      .rejects.toThrow(/只支持 m4a、mp3、wav、aac/)
    await expect(readFile(join(root, RECORDINGS_DIRECTORY, 'notes.txt'))).rejects.toThrow()
  })

  it.each([
    ['a symlinked recordings directory', async (root: string): Promise<void> => {
      const elsewhere = join(root, 'elsewhere')
      await fsp.mkdir(elsewhere, { recursive: true })
      await fsp.symlink(elsewhere, join(root, RECORDINGS_DIRECTORY))
    }],
    ['a same-named file in place of the directory', async (root: string): Promise<void> => {
      await writeFile(join(root, RECORDINGS_DIRECTORY), 'shadow')
    }],
  ])('refuses %s', async (_label, plant) => {
    const root = await scratch()
    await plant(root)
    await expect(service().importAudio({ filename: 'meeting.m4a', bytes: new Uint8Array([1]) }, root))
      .rejects.toThrow(/录音目录不是普通目录/)
  })

  it('gives up after every numbered name is taken', async () => {
    const root = await scratch()
    const directory = join(root, RECORDINGS_DIRECTORY)
    await fsp.mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'meeting.m4a'), 'x')
    for (let index = 2; index <= 100; index += 1) {
      await writeFile(join(directory, `meeting-${String(index)}.m4a`), 'x')
    }
    await expect(service().importAudio({ filename: 'meeting.m4a', bytes: new Uint8Array([1]) }, root))
      .rejects.toThrow(/同名录音文件过多/)
  })

  it('refuses empty bytes', async () => {
    const root = await scratch()
    await expect(service().importAudio({ filename: 'empty.m4a', bytes: new Uint8Array(0) }, root))
      .rejects.toThrow(/录音文件是空的/)
  })

  it('refuses a recording over the configured upload cap', async () => {
    const root = await scratch()
    const bytes = new Uint8Array(1024 * 1024 + 1)
    await expect(service(1).importAudio({ filename: 'long.m4a', bytes }, root))
      .rejects.toThrow(/录音超过 1 MiB 上限/)
    await expect(readFile(join(root, RECORDINGS_DIRECTORY, 'long.m4a'))).rejects.toThrow()
  })

  it('reports a directory that cannot be created', async () => {
    const root = await scratch()
    vi.mocked(fsp.mkdir).mockRejectedValueOnce(new Error('read-only'))
    await expect(service().importAudio({ filename: 'a.m4a', bytes: new Uint8Array([1]) }, root))
      .rejects.toThrow(/没能创建工作区录音目录/)
  })

  it('reports a directory check that cannot run', async () => {
    const root = await scratch()
    vi.mocked(fsp.lstat).mockRejectedValueOnce(new Error('denied'))
    await expect(service().importAudio({ filename: 'a.m4a', bytes: new Uint8Array([1]) }, root))
      .rejects.toThrow(/没能检查工作区录音目录/)
  })

  it('reports a write failure that is not a name collision', async () => {
    const root = await scratch()
    vi.mocked(fsp.writeFile).mockRejectedValueOnce(Object.assign(new Error('no space'), { code: 'ENOSPC' }))
    await expect(service().importAudio({ filename: 'a.m4a', bytes: new Uint8Array([1]) }, root))
      .rejects.toThrow(/没能写入工作区录音文件/)
  })
})
