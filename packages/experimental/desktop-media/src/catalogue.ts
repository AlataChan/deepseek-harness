/**
 * Atomic JSON catalogues under `$DSH_HOME/media`.
 * @module @deepseek-ai/dsh-experimental-desktop-media/catalogue
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveMediaHome } from './media-home.ts'
import type { MediaArtifactRecord, MediaVoiceRecord } from './types.ts'

/** Works catalogue filename. */
export const WORKS_CATALOG = 'catalog/works.json'
/** Voices catalogue filename. */
export const VOICES_CATALOG = 'catalog/voices.json'

/** Works index. */
export interface WorksCatalogue {
  readonly version: 1
  readonly works: readonly MediaArtifactRecord[]
}

/** Voices index. */
export interface VoicesCatalogue {
  readonly version: 1
  readonly voices: readonly MediaVoiceRecord[]
}

/**
 * Empty works catalogue.
 * @returns versioned empty list.
 */
export function emptyWorks(): WorksCatalogue {
  return { version: 1, works: [] }
}

/**
 * Empty voices catalogue.
 * @returns system voices plus an empty cloned list.
 */
export function emptyVoices(): VoicesCatalogue {
  return {
    version: 1,
    voices: [
      { voiceId: 'male-qn-qingse' as MediaVoiceRecord['voiceId'], label: '青涩男声', system: true },
      { voiceId: 'female-shaonv' as MediaVoiceRecord['voiceId'], label: '少女', system: true },
    ],
  }
}

/**
 * Read one JSON catalogue, or the fallback when the file is missing.
 * @param path - absolute catalogue path.
 * @param fallback - value used when the file is absent.
 * @returns parsed catalogue.
 */
export async function readJsonCatalogue<T>(path: string, fallback: T): Promise<T> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    // First use, or a missing catalogue file after a clean media home.
    return fallback
  }
  return JSON.parse(text) as T
}

/**
 * Atomically replace one JSON catalogue.
 * @param path - absolute catalogue path.
 * @param value - new catalogue.
 */
export async function writeJsonCatalogue(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  const tmp = `${path}.${randomUUID()}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}

/**
 * Absolute catalogue paths under the media home.
 * @param env - process environment.
 * @returns works and voices paths.
 */
export function cataloguePaths(env: NodeJS.ProcessEnv = process.env): {
  works: string
  voices: string
} {
  const root = resolveMediaHome(env)
  return {
    works: join(root, WORKS_CATALOG),
    voices: join(root, VOICES_CATALOG),
  }
}

/**
 * Upsert one work and write the catalogue.
 * @param artifact - committed artifact.
 * @param env - process environment.
 * @returns updated catalogue.
 */
export async function upsertWork(
  artifact: MediaArtifactRecord,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorksCatalogue> {
  const path = cataloguePaths(env).works
  const current = await readJsonCatalogue(path, emptyWorks())
  const works = [
    artifact,
    ...current.works.filter(row => row.artifactId !== artifact.artifactId),
  ]
  const next: WorksCatalogue = { version: 1, works }
  await writeJsonCatalogue(path, next)
  return next
}

/**
 * List works, optionally filtered.
 * @param filter - workspace or session filter.
 * @param env - process environment.
 * @returns matching works.
 */
export async function listWorks(
  filter: { workspaceId?: string; sessionId?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<readonly MediaArtifactRecord[]> {
  const current = await readJsonCatalogue(cataloguePaths(env).works, emptyWorks())
  return current.works.filter((row) => {
    if (filter.workspaceId !== undefined && row.workspaceId !== filter.workspaceId) return false
    if (filter.sessionId !== undefined && row.sessionId !== filter.sessionId) return false
    return true
  })
}

/**
 * Find one work by artifact id.
 * @param artifactId - opaque id.
 * @param env - process environment.
 * @returns the row, or undefined.
 */
export async function findWork(
  artifactId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MediaArtifactRecord | undefined> {
  const current = await readJsonCatalogue(cataloguePaths(env).works, emptyWorks())
  return current.works.find(row => row.artifactId === artifactId)
}

/**
 * List voices.
 * @param env - process environment.
 * @returns catalogue voices.
 */
export async function listVoices(
  env: NodeJS.ProcessEnv = process.env,
): Promise<readonly MediaVoiceRecord[]> {
  const current = await readJsonCatalogue(cataloguePaths(env).voices, emptyVoices())
  return current.voices
}

/**
 * Upsert one voice.
 * @param voice - voice row.
 * @param env - process environment.
 * @returns updated catalogue.
 */
export async function upsertVoice(
  voice: MediaVoiceRecord,
  env: NodeJS.ProcessEnv = process.env,
): Promise<VoicesCatalogue> {
  const path = cataloguePaths(env).voices
  const current = await readJsonCatalogue(path, emptyVoices())
  const voices = [
    voice,
    ...current.voices.filter(row => row.voiceId !== voice.voiceId),
  ]
  const next: VoicesCatalogue = { version: 1, voices }
  await writeJsonCatalogue(path, next)
  return next
}
