/**
 * Import admission for audio and video selected for media tools.
 * @module @deepseek-ai/dsh-experimental-desktop-media/admission
 */

import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { MediaError } from './error.ts'
import { sha256Bytes, sha256File } from './hash.ts'
import { MediaArtifactId, MediaRequestId, mintMediaId } from './ids.ts'
import { resolveMediaHome } from './media-home.ts'
import type { MediaArtifactRecord, MediaWorkKind } from './types.ts'

/** Import limits from plugin config. */
export interface ImportLimits {
  /** Maximum imported file size in bytes. */
  readonly maxFileBytes: number
  /** Maximum imported clip duration in seconds. */
  readonly maxClipDurationSeconds: number
}

/** Bytes plus the user-visible name. */
export interface ImportBytes {
  readonly filename: string
  readonly bytes: Uint8Array
}

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.wav'])
const VIDEO_EXT = new Set(['.mp4', '.mov'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])

/** Image MIME used when sending a still to MiniMax. */
export type ImportImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

/**
 * Classify a selected filename.
 * @param filename - user-visible name.
 * @returns audio, video, or image kind.
 */
export function classifyImportName(filename: string): 'audio' | 'video' | 'image' {
  const ext = extname(filename).toLowerCase()
  if (AUDIO_EXT.has(ext)) return 'audio'
  if (VIDEO_EXT.has(ext)) return 'video'
  if (IMAGE_EXT.has(ext)) return 'image'
  throw new MediaError('import-rejected', 'import accepts mp3, m4a, wav, mp4, mov, png, jpg, or webp')
}

/**
 * MIME type for an imported still.
 * @param filename - user-visible name.
 * @returns png, jpeg, or webp.
 */
export function imageMediaType(filename: string): ImportImageMediaType {
  const ext = extname(filename).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  throw new MediaError('import-rejected', 'image import accepts png, jpg, or webp')
}

/**
 * Reject an oversized import before copy.
 * @param bytes - file bytes.
 * @param limits - configured ceiling.
 */
export function assertImportSize(bytes: Uint8Array, limits: ImportLimits): void {
  if (bytes.byteLength > limits.maxFileBytes) {
    throw new MediaError('import-rejected', `import exceeds ${limits.maxFileBytes} bytes`)
  }
  if (bytes.byteLength === 0) {
    throw new MediaError('import-rejected', 'import is empty')
  }
}

/**
 * Commit imported bytes into managed storage.
 * @param request - filename and bytes.
 * @param sessionId - owning session.
 * @param workspaceId - optional workspace.
 * @param limits - size ceiling.
 * @param env - process environment.
 * @param now - injectable clock.
 * @returns committed artifact record.
 */
export async function admitImportBytes(
  request: ImportBytes,
  sessionId: string,
  workspaceId: string | undefined,
  limits: ImportLimits,
  env: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date(),
): Promise<MediaArtifactRecord> {
  classifyImportName(request.filename)
  assertImportSize(request.bytes, limits)
  const digest = sha256Bytes(request.bytes)
  const artifactId = MediaArtifactId(mintMediaId('a'))
  const requestId = MediaRequestId(mintMediaId('r'))
  const ext = extname(request.filename).toLowerCase()
  const destDir = join(resolveMediaHome(env), 'files', artifactId)
  const destPath = join(destDir, `source${ext}`)
  await mkdir(destDir, { recursive: true })
  await writeFile(destPath, request.bytes)
  const workKind: MediaWorkKind = 'import'
  return {
    artifactId,
    requestId,
    kind: workKind,
    name: request.filename,
    file: `source${ext}`,
    digest,
    sessionId: sessionId as MediaArtifactRecord['sessionId'],
    ...workspaceId === undefined ? {} : { workspaceId },
    createdAt: now().toISOString(),
  }
}

/**
 * Copy an already-local absolute file into managed storage after hashing.
 * @param sourcePath - Host-resolved absolute path.
 * @param filename - display name.
 * @param sessionId - owning session.
 * @param workspaceId - optional workspace.
 * @param env - process environment.
 * @param now - injectable clock.
 * @returns committed artifact record.
 */
export async function admitImportPath(
  sourcePath: string,
  filename: string,
  sessionId: string,
  workspaceId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date(),
): Promise<MediaArtifactRecord> {
  classifyImportName(filename)
  const digest = await sha256File(sourcePath)
  const artifactId = MediaArtifactId(mintMediaId('a'))
  const requestId = MediaRequestId(mintMediaId('r'))
  const ext = extname(filename).toLowerCase()
  const destDir = join(resolveMediaHome(env), 'files', artifactId)
  const destPath = join(destDir, `source${ext}`)
  await mkdir(destDir, { recursive: true })
  await copyFile(sourcePath, destPath)
  return {
    artifactId,
    requestId,
    kind: 'import',
    name: filename,
    file: `source${ext}`,
    digest,
    sessionId: sessionId as MediaArtifactRecord['sessionId'],
    ...workspaceId === undefined ? {} : { workspaceId },
    createdAt: now().toISOString(),
  }
}

/**
 * Managed path for a committed artifact file.
 * @param artifactId - opaque id.
 * @param filename - stored basename.
 * @param env - process environment.
 * @returns absolute path.
 */
export function artifactFilePath(
  artifactId: string,
  filename: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveMediaHome(env), 'files', artifactId, filename)
}
