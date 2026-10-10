/**
 * Host staging service for the 录音转文字 entry: admit one browser-selected
 * recording into `<workspaceRoot>/recordings` so the `speech_transcribe` tool
 * can read it by workspace-relative path.
 * @module @deepseek-ai/dsh-experimental-desktop-speech-transcribe/staging
 */

import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'

/** Deployment limits for one staged recording. */
export interface TranscriptAudioConfig {
  /** Maximum accepted upload size in MiB. */
  readonly maxUploadMiB: number
}

/** One staged recording inside the workspace. */
export interface StagedTranscriptAudio {
  /** Workspace-relative POSIX path of the written file. */
  readonly path: string
  /** Stored file name, suffixed when a same-name file already existed. */
  readonly filename: string
}

/** Stable refusal codes the Session Remote forwards to the browser. */
export type TranscriptAudioErrorCode = 'invalid-name' | 'empty' | 'too-large' | 'write-failed'

/** Refused staging request; the Remote maps {@link code} onto its own failure. */
export class TranscriptAudioError extends Error {
  /**
   * @param code - stable failure code.
   * @param message - user-facing Chinese diagnostic.
   * @param options - original failure, when one caused this refusal.
   */
  constructor(
    readonly code: TranscriptAudioErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'TranscriptAudioError'
  }
}

/** Directory under the workspace root that holds staged recordings. */
export const RECORDINGS_DIRECTORY = 'recordings'

/** Collision-free names searched before the write gives up. */
const MAX_COLLISION_ATTEMPTS = 100

/** Recording extensions the staging service accepts, lowercased. */
const AUDIO_EXTENSIONS = new Set(['.m4a', '.mp3', '.wav', '.aac'])

/**
 * Reduce a user-selected file name to a safe single-segment name. Directory
 * parts are stripped to the final segment; a `..` segment, an embedded NUL, or
 * an empty/dot result is refused.
 * @param filename - browser-provided file name.
 * @returns safe single-segment file name.
 * @throws {@link TranscriptAudioError} `invalid-name`.
 */
export function sanitizeRecordingName(filename: string): string {
  const normalized = filename.replaceAll('\\', '/')
  if (filename.includes('\0') || normalized.split('/').some(segment => segment === '..')) {
    throw new TranscriptAudioError('invalid-name', `录音文件名不合法：${filename}`)
  }
  const name = basename(normalized)
  if (name === '' || name === '.' || name === '..') {
    throw new TranscriptAudioError('invalid-name', '录音文件名为空，请重新选择。')
  }
  return name
}

/**
 * Whether a thrown value carries one filesystem error code.
 * @param error - thrown value.
 * @param code - expected errno code.
 * @returns true when the error carries exactly that code.
 */
export function isErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

/**
 * Host staging service registered as `ctx.transcriptAudio`; the
 * session-controller Remote duck-types it.
 */
export class TranscriptAudio extends Service {
  /**
   * @param ctx - Host context.
   * @param config - validated plugin configuration.
   */
  constructor(ctx: Context, private readonly config: TranscriptAudioConfig) {
    super(ctx, 'transcriptAudio')
  }

  /**
   * Write one selected recording under `<workspaceRoot>/recordings` without
   * replacing an existing file.
   * @param request - user file name and decoded bytes.
   * @param workspaceRoot - absolute Session workspace root.
   * @returns workspace-relative path and stored name.
   * @throws {@link TranscriptAudioError} for a refused name, empty bytes, a size over the cap, or a failed write.
   */
  async importAudio(
    request: { filename: string; bytes: Uint8Array },
    workspaceRoot: string,
  ): Promise<StagedTranscriptAudio> {
    const name = sanitizeRecordingName(request.filename)
    if (!AUDIO_EXTENSIONS.has(extname(name).toLowerCase())) {
      throw new TranscriptAudioError('invalid-name', `只支持 m4a、mp3、wav、aac 格式的录音文件：${name}`)
    }
    if (request.bytes.byteLength === 0) {
      throw new TranscriptAudioError('empty', '录音文件是空的，请重新选择。')
    }
    if (request.bytes.byteLength > this.config.maxUploadMiB * 1024 * 1024) {
      throw new TranscriptAudioError(
        'too-large',
        `录音超过 ${String(this.config.maxUploadMiB)} MiB 上限，请改选较短的录音或先压缩。`,
      )
    }
    const directory = join(workspaceRoot, RECORDINGS_DIRECTORY)
    try {
      await mkdir(directory, { recursive: true })
    } catch (error: unknown) {
      if (isErrnoCode(error, 'EEXIST')) {
        throw new TranscriptAudioError('write-failed', '录音目录不是普通目录，已拒绝写入。')
      }
      throw new TranscriptAudioError('write-failed', '没能创建工作区录音目录。', { cause: error })
    }
    await assertPlainDirectory(directory)
    const stored = await writeUnique(directory, name, request.bytes)
    return { path: `${RECORDINGS_DIRECTORY}/${stored}`, filename: stored }
  }
}

/**
 * Refuse a staging target that is not a plain directory, so a planted symlink
 * cannot redirect the write.
 * @param directory - staging directory to verify.
 * @returns nothing; resolves only for a plain directory.
 * @throws {@link TranscriptAudioError} `write-failed` when the target is not a plain directory.
 */
async function assertPlainDirectory(directory: string): Promise<void> {
  const target = await lstat(directory).catch((error: unknown): never => {
    throw new TranscriptAudioError('write-failed', '没能检查工作区录音目录。', { cause: error })
  })
  if (!target.isDirectory()) {
    throw new TranscriptAudioError('write-failed', '录音目录不是普通目录，已拒绝写入。')
  }
}

/**
 * Write bytes under a name no existing file uses: the first collision becomes
 * `<stem>-2<ext>`, then increments.
 * @param directory - target directory that already exists.
 * @param name - sanitized desired file name.
 * @param bytes - decoded recording bytes.
 * @returns the stored file name.
 * @throws {@link TranscriptAudioError} `write-failed`.
 */
async function writeUnique(directory: string, name: string, bytes: Uint8Array): Promise<string> {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let attempt = 1; attempt <= MAX_COLLISION_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 1 ? name : `${stem}-${String(attempt)}${ext}`
    try {
      await writeFile(join(directory, candidate), bytes, { flag: 'wx' })
      return candidate
    } catch (error: unknown) {
      if (!isErrnoCode(error, 'EEXIST')) {
        throw new TranscriptAudioError('write-failed', '没能写入工作区录音文件。', { cause: error })
      }
    }
  }
  throw new TranscriptAudioError('write-failed', `同名录音文件过多，没能写入「${name}」。`)
}
