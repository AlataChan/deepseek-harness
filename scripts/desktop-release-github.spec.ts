import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { GitHubDesktopReleaseTransport, type ReleaseFetch } from './desktop-release-github.ts'
const commit = 'a'.repeat(40)
describe('fork GitHub release adapter', () => {
  it('resolves lightweight tags, reads actual bytes and uses only fork upload endpoints', async () => {
    const requests: { url: string; method: string }[] = []
    const request: ReleaseFetch = (input, init) => {
      const url = (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url); requests.push({ url, method: init?.method ?? 'GET' })
      if (url.includes('/git/ref/tags/')) return Promise.resolve(Response.json({ object: { type: 'commit', sha: commit } }))
      if (url.includes('/releases/tags/')) return Promise.resolve(Response.json({ id: 11 }))
      if (url.includes('/assets?per_page=')) return Promise.resolve(Response.json([{ id: 22, name: 'octopus-1.2.3.exe', updated_at: '2026-10-18T00:00:00Z' }]))
      if (url.includes('/releases/assets/22')) return Promise.resolve(new Response('artifact bytes'))
      if (url.startsWith('https://uploads.github.com/')) return Promise.resolve(Response.json({ id: 23 }, { status: 201 }))
      throw new Error(`Unexpected fixture URL: ${url}`)
    }
    const remote = new GitHubDesktopReleaseTransport('desktop-v1.2.3', 'stable-windows-x64', 'synthetic-secret', request)
    expect(await remote.sourceCommit()).toBe(commit)
    expect(Buffer.from((await remote.read('octopus-1.2.3.exe'))?.bytes ?? []).toString()).toBe('artifact bytes')
    await remote.create('octopus-1.2.3-macos-arm64.dmg', Buffer.from('dmg'))
    expect(requests.at(-1)).toEqual({ url: 'https://uploads.github.com/repos/AlataChan/deepseek-harness/releases/11/assets?name=octopus-1.2.3-macos-arm64.dmg', method: 'POST' })
    expect(requests.every(r => r.url.includes('/AlataChan/deepseek-harness/'))).toBe(true)
  })
  it('refuses a channel replacement when the observed revision moved', async () => {
    const request: ReleaseFetch = (input, init) => {
      if (init?.method === 'DELETE' || init?.method === 'POST') throw new Error('A stale writer must not mutate')
      const url = (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      if (url.includes('/releases/tags/')) return Promise.resolve(Response.json({ id: 11 }))
      if (url.includes('/assets?per_page=')) return Promise.resolve(Response.json([{ id: 22, name: 'channel-stable-windows-x64.json', updated_at: 'new' }]))
      return Promise.resolve(new Response('changed channel'))
    }
    const remote = new GitHubDesktopReleaseTransport('desktop-v1.2.3', 'stable-windows-x64', 'synthetic-secret', request)
    await expect(remote.replaceChannel('channel-stable-windows-x64.json', Buffer.from('new'), 'old-revision')).rejects.toThrow(/revision changed/)
  })
})

describe('workflow archive verification', () => {
  it.skipIf(process.platform === 'win32')('compares independently downloaded archive and packed installer bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-archive-control-'))
    try {
      const name = 'octopus-1.2.3-windows-x64.exe'
      const binary = Buffer.from('actual workflow installer')
      writeFileSync(join(dir, name), binary)
      const zip = join(dir, 'archive.zip')
      const result = spawnSync('/usr/bin/zip', ['-q', zip, name], { cwd: dir })
      expect(result.status).toBe(0)
      const bytes = readFileSync(zip)
      const digest = createHash('sha256').update(bytes).digest('hex')
      const manifest = {
        schemaVersion: 1 as const, mode: 'public' as const, repository: 'AlataChan/deepseek-harness', ref: 'refs/heads/release',
        release: { version: '1.2.3', commit }, shellVersion: '1.2.3', target: 'windows-x64' as const, payloadSha256: 'b'.repeat(64),
        artifact: { name, bytes: binary.length, sha256: createHash('sha256').update(binary).digest('hex') },
        workflow: { path: '.github/workflows/desktop-windows.yml', commit, runId: 123, attempt: 2, artifactName: 'build-123-2' },
      }
      const request: ReleaseFetch = input => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).endsWith('/zip')
        ? Promise.resolve(new Response(bytes))
        : Promise.resolve(Response.json({ total_count: 1, artifacts: [{ id: 99, expired: false, digest: `sha256:${digest}`, workflow_run: { id: 123, head_sha: commit } }] }))
      const remote = new GitHubDesktopReleaseTransport('desktop-v1.2.3', 'stable-windows-x64', 'synthetic-secret', request)
      await expect(remote.verifyArtifactArchive(manifest)).resolves.toBeUndefined()
      await expect(remote.verifyArtifactArchive({ ...manifest, artifact: { ...manifest.artifact, sha256: 'c'.repeat(64) } })).rejects.toThrow(/actual GitHub workflow artifact/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
