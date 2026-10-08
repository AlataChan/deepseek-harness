import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cataloguePaths, emptyVoices, emptyWorks, findWork, listVoices, listWorks, readJsonCatalogue,
  upsertVoice, upsertWork, writeJsonCatalogue,
} from '../src/catalogue.ts'
import { MediaArtifactId, MediaRequestId, MediaVoiceId } from '../src/ids.ts'
import type { MediaArtifactRecord } from '../src/types.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

function work(id: string, extra: Partial<MediaArtifactRecord> = {}): MediaArtifactRecord {
  return {
    artifactId: MediaArtifactId(id),
    requestId: MediaRequestId('r_1'),
    kind: 'video',
    name: '样片.mp4',
    file: 'result.mp4',
    digest: 'aa',
    sessionId: SessionId('s-1'),
    createdAt: '2026-09-20T00:00:00.000Z',
    ...extra,
  }
}

describe('catalogue', () => {
  it('returns fallbacks for missing files and upserts works and voices', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-media-catalog-'))
    const env = { DSH_HOME: root }
    expect(await readJsonCatalogue(join(root, 'missing.json'), emptyWorks())).toEqual(emptyWorks())
    expect(emptyVoices().voices).toHaveLength(2)
    const paths = cataloguePaths(env)
    expect(paths.works).toContain('works.json')

    const first = work('a_1', { workspaceId: 'w-1' })
    await upsertWork(first, env)
    await upsertWork(work('a_1', { name: 'replaced.mp4', workspaceId: 'w-1' }), env)
    await upsertWork(work('a_2', { sessionId: SessionId('s-2') }), env)
    expect(await listWorks({ workspaceId: 'w-1' }, env)).toHaveLength(1)
    expect(await listWorks({ sessionId: 's-2' }, env)).toHaveLength(1)
    expect(await findWork('a_2', env)).toMatchObject({ artifactId: 'a_2' })
    expect(await findWork('missing', env)).toBeUndefined()

    await upsertVoice({ voiceId: MediaVoiceId('v_1'), label: 'mine', system: false }, env)
    await upsertVoice({ voiceId: MediaVoiceId('v_1'), label: 'renamed', system: false }, env)
    const voices = await listVoices(env)
    expect(voices.some(row => row.voiceId === 'v_1' && row.label === 'renamed')).toBe(true)

    await writeJsonCatalogue(join(root, 'x.json'), { ok: true })
  })
})
