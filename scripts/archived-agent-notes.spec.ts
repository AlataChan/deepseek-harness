import { describe, expect, it } from 'vitest'
import {
  extendArchiveManifest,
  gitBlobHash,
  parseArchiveManifest,
  renderArchiveManifest,
  validateArchiveArtifacts,
  validateArchiveManifestExtension,
  type ArchiveManifest,
} from './archived-agent-notes.ts'
import { isArchivedAgentNotePath } from './repo-files.ts'

function fixture(): Map<string, Buffer> {
  const base = '2026-07-26-example'
  const source = Buffer.from(`# Agent Note: Example\n\nStatus: implemented\nArchived: 2026-07-26\n\nEnglish | [中文](${base}.zh.md)\n\n## Problem\n\nExample.\n`)
  const zh = Buffer.from(`# Agent Note: 示例\n\nStatus: implemented\nArchived: 2026-07-26\n\n[English](${base}.md) | 中文\n\n## 问题\n\n示例。\n`)
  const meta = Buffer.from(`${base}.md: ${gitBlobHash(source)}\n${base}.zh.md: ${gitBlobHash(zh)}\n`)
  return new Map([
    [`process/${base}.md`, source],
    [`process/${base}.zh.md`, zh],
    [`process/${base}.i18n.yaml`, meta],
  ])
}

describe('archived Agent Notes', () => {
  it('recognizes archived paths with POSIX and Windows separators', () => {
    expect(isArchivedAgentNotePath('.agents/notes/archived/process/example.md')).toBe(true)
    expect(isArchivedAgentNotePath('.agents\\notes\\archived\\process\\example.md')).toBe(true)
    expect(isArchivedAgentNotePath('.agents/notes/implemented/process/example.md')).toBe(false)
  })

  it('accepts one complete implemented triplet with matching archive metadata', () => {
    expect(validateArchiveArtifacts(fixture())).toEqual([])
  })

  it.each(['# Agent Note：示例', '# Historical decision'])('preserves historical formatting: %s', (title) => {
    const artifacts = fixture()
    const base = '2026-07-26-example'
    const source = Buffer.from(`${title}\nStatus: implemented\nArchived: 2026-07-26\n[中文版本](${base}.zh.md)\n`)
    artifacts.set(`process/${base}.md`, source)
    const zh = artifacts.get(`process/${base}.zh.md`)!
    artifacts.set(`process/${base}.i18n.yaml`, Buffer.from(`${base}.md: ${gitBlobHash(source)}\n${base}.zh.md: ${gitBlobHash(zh)}\n`))
    expect(validateArchiveArtifacts(artifacts)).toEqual([])
  })

  it.each([
    ['Status: proposed\nArchived: 2026-07-26', /requires `Status: implemented`/],
    ['Status: implemented\n\nArchived: 2026-07-26', /immediately after the status/],
    ['Status: implemented\nArchived: 2026-02-30', /valid date/],
    ['Status: implemented\nArchived: 2026-07-25', /predates the note filename/],
    ['Status: implemented\nArchived: 2026-07-27', /English and Chinese archive dates differ/],
    ['Archived: 2026-07-26\nStatus: implemented\nArchived: 2026-07-27', /English and Chinese archive dates differ/],
  ])('rejects invalid archive metadata: %s', (metadata, error) => {
    const artifacts = fixture()
    const base = '2026-07-26-example'
    const source = Buffer.from(`# Historical decision\n${metadata}\n`)
    artifacts.set(`process/${base}.md`, source)
    const zh = artifacts.get(`process/${base}.zh.md`)!
    artifacts.set(`process/${base}.i18n.yaml`, Buffer.from(`${base}.md: ${gitBlobHash(source)}\n${base}.zh.md: ${gitBlobHash(zh)}\n`))
    expect(validateArchiveArtifacts(artifacts).join('\n')).toMatch(error)
  })

  it('rejects incomplete triplets and invalid archive headers', () => {
    const artifacts = fixture()
    artifacts.delete('process/2026-07-26-example.i18n.yaml')
    artifacts.set(
      'process/2026-07-26-example.md',
      Buffer.from('# Agent Note: Example\n\nStatus: proposed\nArchived: yesterday\n'),
    )
    expect(validateArchiveArtifacts(artifacts).join('\n')).toMatch(/incomplete archived triplet/)
  })

  it('extends the manifest without permitting a sealed change or removal', () => {
    const artifacts = fixture()
    const empty: ArchiveManifest = { version: 1, files: {} }
    const first = extendArchiveManifest(empty, artifacts)
    expect(first.errors).toEqual([])
    expect(first.added).toHaveLength(3)

    const sealed: ArchiveManifest = { version: 1, files: first.files }
    const changed = new Map(artifacts)
    changed.set('process/2026-07-26-example.md', Buffer.from('changed'))
    expect(extendArchiveManifest(sealed, changed).errors).toEqual([
      'process/2026-07-26-example.md: sealed content hash changed',
    ])
    changed.delete('process/2026-07-26-example.zh.md')
    expect(extendArchiveManifest(sealed, changed).errors).toContain(
      'process/2026-07-26-example.zh.md: sealed artifact is missing',
    )
  })

  it('rejects replacing manifest seals alongside changed archive content', () => {
    const artifacts = fixture()
    const initial = extendArchiveManifest({ version: 1, files: {} }, artifacts)
    const baseline: ArchiveManifest = { version: 1, files: initial.files }
    const path = 'process/2026-07-26-example.md'
    const changedArtifacts = new Map(artifacts)
    changedArtifacts.set(path, Buffer.from('changed'))
    const replacement = extendArchiveManifest({ version: 1, files: {} }, changedArtifacts)
    const current: ArchiveManifest = { version: 1, files: replacement.files }

    expect(extendArchiveManifest(current, changedArtifacts).errors).toEqual([])
    expect(validateArchiveManifestExtension(baseline, current)).toEqual([
      `${path}: sealed manifest hash changed`,
    ])
    const removed: ArchiveManifest = {
      version: 1,
      files: Object.fromEntries(Object.entries(current.files).filter(([candidate]) => candidate !== path)),
    }
    expect(validateArchiveManifestExtension(baseline, removed)).toContain(
      `${path}: sealed manifest entry is missing`,
    )
  })

  it.each([
    {
      path: 'feature/2026-08-10-durable-workflow-runs-in-chat.md',
      before: 'sha256:f9f5290cd880908d17b1080ae5776f22e182f5253471f90cf8bead418b33b502',
      after: 'sha256:6018de4a89ca99d6cbfd618aff1c8136b23d8e4854a30f7b12a602f0417cbdc2',
    },
    {
      path: 'feature/2026-08-10-durable-workflow-runs-in-chat.zh.md',
      before: 'sha256:f4ffd2700bc9c2a0cc4b9d90f84e1d0a576939e2e6f0b130c5b142fd8cd518b0',
      after: 'sha256:0080859221773122022d5880efa3d52f29c0872b52d63e170250d94f214ff37a',
    },
    {
      path: 'feature/2026-08-10-durable-workflow-runs-in-chat.i18n.yaml',
      before: 'sha256:0db3c21a3c8785e56d5d7b90df990b158069cd1cea664e62fc4786c6d7588450',
      after: 'sha256:03eadb60c8ba4fde262cd61e3f911d8cd68ea4a58f57adeb8dd7bb9a97d08ca2',
    },
    {
      path: 'architecture/2026-09-11-node-office-kit.zh.md',
      before: 'sha256:a62fcfe872ddd8952c0115c646d5114451316e4eb656bfb8e78c500e52b75174',
      after: 'sha256:448a7bfd17e4c7f617d7f3e71753b4900f284885064b2bfa4bc18a1ad25f53c2',
    },
    {
      path: 'architecture/2026-09-11-node-office-kit.i18n.yaml',
      before: 'sha256:eaa46c9c097fd8ff307f51d7e108d58d46d4daa4e5152e7498893647ba18f1d8',
      after: 'sha256:8488b13ba8181c3348e2273abaa3a0b669e8b0ddf045480b27d830f324a69420',
    },
    {
      path: 'feature/2026-08-25-feedback-gated-telemetry-default.md',
      before: 'sha256:ab08d9d27dc243997bd49b4b70c5691fa48ea50ea10ebe8ac7640ac896dab4af',
      after: 'sha256:f5cd69cc9b18b36a2dbde8e9fddbc824d1720d6e9a2e764047a0fa2b0fb5ec71',
    },
    {
      path: 'feature/2026-08-25-feedback-gated-telemetry-default.zh.md',
      before: 'sha256:8dbff071744c6a3e89a1b0667b8c8501ac6663cccb13de049942dd094d95e8a4',
      after: 'sha256:0f2555a1bb89ad0d38383276698e087ef244c4c8ba00e9b49eed3dc72f08727f',
    },
    {
      path: 'feature/2026-08-25-feedback-gated-telemetry-default.i18n.yaml',
      before: 'sha256:24d1e844ebc2f1d299fdddd734b323e80410d33ea15b832a9be2a654583e534f',
      after: 'sha256:35e044dbe0f88a4e53371db2623c49540ab47e73c92ee21662727d1eab5090e4',
    },
    {
      path: 'process/2026-09-16-desktop-release-version-derivation.zh.md',
      before: 'sha256:d1e5c4396e4c1333cbd9dbaf9a515ecb78fa20750641b94f92f96d8a2988c3a2',
      after: 'sha256:af94b0f50358e7e54898f73eea4412fb08b9f7597ff99bc67e52ab98b96acaa1',
    },
    {
      path: 'process/2026-09-16-desktop-release-version-derivation.i18n.yaml',
      before: 'sha256:d78b7e7249e7a9554f8fef2ef20fbeb0a362fec009c1f6f2cfb083f3e56c6d8c',
      after: 'sha256:6101138bd91e923fb62d05969e54f89efeac1fa13f0284646d760e4177b31815',
    },
    {
      path: 'process/2026-09-21-desktop-build-version-as-input.zh.md',
      before: 'sha256:68c74765e736237e9651a8ecb1ae4a37958d1d63cdadbe7dc77aef9c698a1a58',
      after: 'sha256:7a45d83e57afe16791adce6b615ad3c96fe3652e803420e150fe7b33c99b9e15',
    },
    {
      path: 'process/2026-09-21-desktop-build-version-as-input.i18n.yaml',
      before: 'sha256:99a9a228425c2ac6bdce1fa2b6bac51a29a1aa0a1339e20b35c08360ed75cd98',
      after: 'sha256:89712c06f953cd9746aa2c7615a1d8e465e6b74d0a0a6ae85413bbe5b55ca2b1',
    },
  ])('accepts only the authorized seal transition for $path', ({ path, before, after }) => {
    const manifest = (hash: string): ArchiveManifest => ({ version: 1, files: { [path]: hash } })
    expect(validateArchiveManifestExtension(manifest(before), manifest(after))).toEqual([])
    expect(validateArchiveManifestExtension(manifest(after), manifest(before))).toEqual([
      `${path}: sealed manifest hash changed`,
    ])
    expect(validateArchiveManifestExtension(manifest(before), manifest('sha256:' + '0'.repeat(64)))).toHaveLength(1)
    expect(validateArchiveManifestExtension(manifest('sha256:' + '0'.repeat(64)), manifest(after))).toHaveLength(1)
    expect(validateArchiveManifestExtension(manifest(before), { version: 1, files: {} })).toHaveLength(1)
    expect(validateArchiveManifestExtension(
      { version: 1, files: { 'process/other.md': before } },
      { version: 1, files: { 'process/other.md': after } },
    )).toHaveLength(1)
  })

  it('round-trips the deterministic manifest schema', () => {
    const content = renderArchiveManifest({ 'process/z.md': `sha256:${'a'.repeat(64)}` })
    expect(parseArchiveManifest(content)).toEqual({
      version: 1,
      files: { 'process/z.md': `sha256:${'a'.repeat(64)}` },
    })
  })
})
