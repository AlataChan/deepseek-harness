import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { admitImportBytes, admitImportPath, artifactFilePath, assertImportSize, classifyImportName, imageMediaType } from '../src/admission.ts'
import { MediaError } from '../src/error.ts'

const previousHome = process.env.DSH_HOME
const limits = { maxFileBytes: 16, maxClipDurationSeconds: 15 }

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
})

describe('admission', () => {
  it('classifies audio and video names and rejects others', () => {
    expect(classifyImportName('a.MP3')).toBe('audio')
    expect(classifyImportName('a.m4a')).toBe('audio')
    expect(classifyImportName('a.wav')).toBe('audio')
    expect(classifyImportName('a.mp4')).toBe('video')
    expect(classifyImportName('a.mov')).toBe('video')
    expect(classifyImportName('a.png')).toBe('image')
    expect(classifyImportName('a.JPG')).toBe('image')
    expect(classifyImportName('a.webp')).toBe('image')
    expect(() => classifyImportName('a.txt')).toThrow(MediaError)
    expect(imageMediaType('a.png')).toBe('image/png')
    expect(imageMediaType('a.jpg')).toBe('image/jpeg')
    expect(imageMediaType('a.jpeg')).toBe('image/jpeg')
    expect(imageMediaType('a.webp')).toBe('image/webp')
    expect(() => imageMediaType('a.mp4')).toThrow(MediaError)
  })

  it('rejects empty and oversized imports', () => {
    expect(() => assertImportSize(new Uint8Array(), limits)).toThrow(MediaError)
    expect(() => assertImportSize(new Uint8Array(17), limits)).toThrow(MediaError)
    assertImportSize(new Uint8Array(4), limits)
  })

  it('commits bytes and paths into the media home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-media-admit-'))
    process.env.DSH_HOME = root
    const env = { DSH_HOME: root }
    const artifact = await admitImportBytes({
      filename: '旁白.mp3',
      bytes: new Uint8Array([1, 2, 3]),
    }, 's-1', 'w-1', limits, env, () => new Date('2026-09-20T00:00:00.000Z'))
    expect(artifact.kind).toBe('import')
    expect(artifact.workspaceId).toBe('w-1')
    expect(artifactFilePath(artifact.artifactId, artifact.file, env)).toContain(artifact.artifactId)

    const source = join(root, 'clip.mp4')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(source, 'clip')
    const copied = await admitImportPath(source, '镜头.mp4', 's-1', undefined, env)
    expect(copied.workspaceId).toBeUndefined()
    expect(copied.file).toBe('source.mp4')
    const copiedWorkspace = await admitImportPath(source, '镜头.mp4', 's-1', 'w-2', env)
    expect(copiedWorkspace.workspaceId).toBe('w-2')
  })
})
