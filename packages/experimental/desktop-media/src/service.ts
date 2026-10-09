/**
 * Host `ctx.desktopMedia` service.
 * @module @deepseek-ai/dsh-experimental-desktop-media/service
 */

import { access, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobId, JobRegistry } from '@deepseek-ai/dsh-jobs'
import { MediaError } from './error.ts'
import { sha256Bytes, sha256File } from './hash.ts'
import { MediaArtifactId, MediaRequestId, MediaVoiceId, mintMediaId } from './ids.ts'
import { admitImportBytes, artifactFilePath, imageMediaType, type ImportBytes, type ImportLimits } from './admission.ts'
import { assertApprovalMatches, sameHashSet } from './approval.ts'
import {
  assertBudgetAllows, ESTIMATE_CLONE_YUAN, ESTIMATE_TTS_YUAN, ESTIMATE_VIDEO_YUAN,
  type MediaBudgetConfig,
} from './budget.ts'
import { findWork, listVoices, listWorks, upsertVoice, upsertWork } from './catalogue.ts'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'
import { composeAudiovisual, type ComposeRequest, type ComposeResult } from './compositor.ts'
import { appendMediaEvent, type SessionFlush } from './journal.ts'
import { isMissingJobController, startMediaJob } from './jobs.ts'
import { openMediaFile, revealMediaFile, SYSTEM_OPEN_REQUESTED } from './local-open.ts'
import {
  mediaRuntimeBinaries, resolveMediaHome, tryResolveMediaRuntimeHome,
  type MediaRuntimeHomeConfig,
} from './media-home.ts'
import {
  createCloneVoiceId, createMinimaxTransport, createVideoTask, downloadProviderFile,
  MINIMAX_API_KEY_REF, resolveMinimaxApiKey, synthesizeSpeech, uploadVoiceCloneFile,
  cloneVoice, waitForVideoTask, type MinimaxCredentialLookup, type MinimaxTransport,
  type VideoImageInput,
} from './provider.ts'
import { emptyMediaState } from './projection.ts'
import { recoverMediaJobs } from './recovery.ts'
import { assertUserRuntimeReady } from './runtime.ts'
import type { MediaArtifactRecord, MediaProjectionState, MediaRequestRecord, MediaVoiceRecord, MediaWorkKind } from './types.ts'

/** Validated plugin configuration. */
export interface DesktopMediaConfig extends MediaRuntimeHomeConfig, MediaBudgetConfig, ImportLimits {
  /** Provider task polling cadence in milliseconds. */
  readonly pollIntervalMs: number
  /** Deadline in milliseconds for one provider task to finish. */
  readonly pollTimeoutMs: number
  /** Video provider model id sent in create requests. */
  readonly videoModel: 'MiniMax-H3' | 'MiniMax-H3-Max'
  /** TTS provider model id sent in speech requests. */
  readonly ttsModel: string
  /** Default video duration in seconds when the caller omits one. */
  readonly defaultDurationSeconds: number
  /** Default video resolution when the caller omits one. */
  readonly defaultResolution: '480P' | '768P' | '2K'
  /** Default aspect ratio when the caller omits one. */
  readonly defaultRatio: '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
  /** Maximum clips one compose call may join. */
  readonly maxClipCount: number
}

/** Injectable Host seams. */
export interface DesktopMediaInternals {
  readonly credentials?: MinimaxCredentialLookup
  readonly flush?: SessionFlush
  readonly transport?: MinimaxTransport
  readonly now?: () => Date
  readonly compose?: (request: ComposeRequest) => Promise<ComposeResult>
  readonly runtimeReady?: (signal: AbortSignal) => Promise<MediaRuntimeStatus>
}

/** Runtime status for the Works empty/install state. */
export interface MediaRuntimeStatus {
  readonly ready: boolean
  readonly homeDisplay: string
  readonly guidance: string
}

/** Video creation arguments after Host validation. */
export interface CreateVideoArgs {
  readonly prompt: string
  readonly duration: number
  readonly ratio: DesktopMediaConfig['defaultRatio']
  readonly resolution: DesktopMediaConfig['defaultResolution']
  readonly model: DesktopMediaConfig['videoModel']
  /** Imported still artifact ids. */
  readonly imageIds?: readonly string[]
  /** Reference stills, or exclusive first/last-frame pair. */
  readonly imageMode?: 'reference' | 'first_last'
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopMedia: DesktopMedia
  }
}

/** Hash-bound confirmation for a paid create call. */
export interface MediaApprovalInput {
  readonly promptHash: string
  readonly estimatedYuan: number
  readonly inputHashes?: readonly string[]
  readonly requestId?: string
}

/**
 * Look up an optional Host seam on this fiber or the root context.
 * @param ctx - plugin or service context.
 * @param name - provided service name.
 * @returns the seam, or undefined.
 */
export function optionalHostSeam<T>(ctx: Context, name: string): T | undefined {
  return (ctx.get(name) ?? ctx.root.get(name)) as T | undefined
}

/**
 * Overlay media service: catalogues, open/reveal, and paid producers.
 */
export class DesktopMedia extends Service {
  /**
   * @param ctx - Host context.
   * @param config - validated plugin configuration.
   * @param internals - test seams.
   */
  constructor(
    ctx: Context,
    readonly config: DesktopMediaConfig,
    private readonly internals: DesktopMediaInternals = {},
  ) {
    super(ctx, 'desktopMedia')
  }

  /**
   * Whether user FFmpeg is recorded and has the V1 encoders.
   * @param signal - caller lifetime.
   * @returns ready flag and install guidance.
   */
  async runtimeStatus(signal: AbortSignal): Promise<MediaRuntimeStatus> {
    if (this.internals.runtimeReady !== undefined) return this.internals.runtimeReady(signal)
    const home = await tryResolveMediaRuntimeHome(this.config)
    if (home === undefined) {
      return {
        ready: false,
        homeDisplay: '$DSH_HOME/media',
        guidance: 'run scripts/install-media-runtime.sh',
      }
    }
    try {
      await assertUserRuntimeReady(mediaRuntimeBinaries(home).ffmpeg, signal)
      return { ready: true, homeDisplay: '$DSH_HOME/media', guidance: '' }
    } catch {
      // Encoder probe failed; keep the recorded home but do not compose.
      return {
        ready: false,
        homeDisplay: '$DSH_HOME/media',
        guidance: 'FFmpeg is missing h264_videotoolbox or aac',
      }
    }
  }

  /**
   * List retained works without activating a session.
   * @param filter - optional workspace or session filter.
   * @returns catalogue rows.
   */
  listWorks(filter: { workspaceId?: string; sessionId?: string } = {}): Promise<readonly MediaArtifactRecord[]> {
    return listWorks(filter)
  }

  /**
   * List system and cloned voices.
   * @returns catalogue rows.
   */
  listVoices(): Promise<readonly MediaVoiceRecord[]> {
    return listVoices()
  }

  /**
   * Open a registered work in the system default application.
   * @param artifactId - opaque catalogue id.
   * @param signal - caller lifetime.
   * @returns model-safe open wording.
   */
  async openWork(artifactId: string, signal: AbortSignal): Promise<{ requested: true; message: string }> {
    await openMediaFile(await this.resolveWorkPath(artifactId), signal)
    return { requested: true, message: SYSTEM_OPEN_REQUESTED }
  }

  /**
   * Reveal a registered work in the file manager.
   * @param artifactId - opaque catalogue id.
   * @param signal - caller lifetime.
   * @returns model-safe open wording.
   */
  async revealWork(artifactId: string, signal: AbortSignal): Promise<{ requested: true; message: string }> {
    await revealMediaFile(await this.resolveWorkPath(artifactId), signal)
    return { requested: true, message: SYSTEM_OPEN_REQUESTED }
  }

  /**
   * Copyable absolute path for a registered work.
   * @param artifactId - opaque catalogue id.
   * @returns absolute path.
   */
  async copyWorkPath(artifactId: string): Promise<{ path: string }> {
    return { path: await this.resolveWorkPath(artifactId) }
  }

  /**
   * Copy a registered work into a user-chosen directory.
   * @param artifactId - opaque catalogue id.
   * @param destDir - absolute destination directory.
   * @param filename - basename only.
   * @returns written path.
   */
  async saveWorkAs(artifactId: string, destDir: string, filename: string): Promise<{ path: string }> {
    if (!isAbsolute(destDir)) {
      throw new MediaError('path-not-absolute', 'save-as directory must be absolute')
    }
    if (filename.includes('/') || filename.includes('\\') || filename === '' || filename === '.' || filename === '..') {
      throw new MediaError('import-rejected', 'save-as filename is invalid')
    }
    const dest = join(destDir, filename)
    try {
      await access(dest)
      throw new MediaError('save-as-exists', 'save-as destination already exists')
    } catch (error: unknown) {
      if (error instanceof MediaError) throw error
      if (!isMissingPath(error)) throw error
    }
    await copyFile(await this.resolveWorkPath(artifactId), dest)
    return { path: dest }
  }

  /**
   * Admit selected bytes into managed storage.
   * @param request - filename and bytes.
   * @param sessionId - owning session.
   * @param workspaceId - optional workspace.
   * @returns committed artifact.
   */
  async importBytes(
    request: ImportBytes,
    sessionId: string,
    workspaceId: string | undefined,
  ): Promise<MediaArtifactRecord> {
    const artifact = await admitImportBytes(request, sessionId, workspaceId, this.config)
    await upsertWork(artifact)
    return artifact
  }

  /**
   * Start a paid video job after the caller has a live owner and approval.
   * @param owner - live agent.
   * @param args - validated generation args.
   * @param approval - hash-bound confirmation.
   * @returns durable request id and process-local job id.
   */
  async createVideo(
    owner: Agent,
    args: CreateVideoArgs,
    approval: MediaApprovalInput,
  ): Promise<{ requestId: MediaRequestId; jobId: JobId }> {
    const images = await this.resolveVideoImages(args.imageIds, args.imageMode)
    const imageHashes = images.map(image => sha256Bytes(image.bytes))
    const state = this.projectionOf(owner)
    assertBudgetAllows(state, this.config, approval.estimatedYuan)
    const request = this.approvedRequest(state, {
      ...approval,
      inputHashes: approval.inputHashes ?? imageHashes,
    }, {
      kind: 'video',
      label: args.prompt.slice(0, 80),
      model: args.model,
    })
    await appendMediaEvent(owner, 'media/request', { version: 1, request }, this.sessionFlush())
    await appendMediaEvent(owner, 'media/approval', {
      version: 1,
      requestId: request.requestId,
      inputHashes: request.inputHashes,
      promptHash: approval.promptHash,
      estimatedYuan: approval.estimatedYuan,
    }, this.sessionFlush())
    const jobId = this.startOwnedJob(
      owner,
      request.label,
      request.requestId,
      signal => this.runVideo(owner, request, args, images, signal),
    )
    return { requestId: request.requestId, jobId }
  }

  /**
   * Start a paid speech job.
   * @param owner - live agent.
   * @param text - narration copy.
   * @param voiceId - system or cloned voice.
   * @param approval - hash-bound confirmation.
   * @returns durable request id and job id.
   */
  async createSpeech(
    owner: Agent,
    text: string,
    voiceId: string,
    approval: MediaApprovalInput,
  ): Promise<{ requestId: MediaRequestId; jobId: JobId }> {
    const voices = await listVoices()
    if (!voices.some(row => row.voiceId === voiceId)) {
      throw new MediaError('voice-unavailable', 'voice is not in the local catalogue')
    }
    const state = this.projectionOf(owner)
    assertBudgetAllows(state, this.config, approval.estimatedYuan)
    const request = this.approvedRequest(state, approval, {
      kind: 'speech',
      label: text.slice(0, 80),
      model: this.config.ttsModel,
    })
    await appendMediaEvent(owner, 'media/request', { version: 1, request }, this.sessionFlush())
    await appendMediaEvent(owner, 'media/approval', {
      version: 1,
      requestId: request.requestId,
      inputHashes: request.inputHashes,
      promptHash: approval.promptHash,
      estimatedYuan: approval.estimatedYuan,
    }, this.sessionFlush())
    const jobId = this.startOwnedJob(
      owner,
      request.label,
      request.requestId,
      signal => this.runSpeech(owner, request, text, voiceId, signal),
    )
    return { requestId: request.requestId, jobId }
  }

  /**
   * Clone a voice from a registered import after consent.
   * @param owner - live agent.
   * @param artifactId - imported sample.
   * @param label - display name.
   * @param consent - speaker declaration.
   * @returns new local voice id.
   */
  async cloneVoiceFromArtifact(
    owner: Agent,
    artifactId: string,
    label: string,
    consent: { speakerIsUser: boolean; authorized: boolean },
  ): Promise<{ voiceId: MediaVoiceId }> {
    if (!consent.authorized) {
      throw new MediaError('consent-missing', 'voice clone requires explicit consent')
    }
    const work = await findWork(artifactId)
    if (work === undefined) throw new MediaError('artifact-missing', 'clone sample is not registered')
    if (work.sessionId !== owner.session.id) {
      throw new MediaError('session-mismatch', 'clone sample belongs to another session')
    }
    assertBudgetAllows(this.projectionOf(owner), this.config, ESTIMATE_CLONE_YUAN)
    const path = artifactFilePath(work.artifactId, work.file)
    const digest = await sha256File(path)
    const request = this.requestRecord({
      kind: 'import',
      label: `clone ${label}`,
      estimatedYuan: ESTIMATE_CLONE_YUAN,
      stage: 'approved',
      promptHash: digest,
      inputHashes: [digest],
    })
    await appendMediaEvent(owner, 'media/request', { version: 1, request }, this.sessionFlush())
    await appendMediaEvent(owner, 'media/approval', {
      version: 1,
      requestId: request.requestId,
      inputHashes: [digest],
      promptHash: digest,
      estimatedYuan: ESTIMATE_CLONE_YUAN,
    }, this.sessionFlush())
    const transport = await this.transport()
    const { readFile } = await import('node:fs/promises')
    const bytes = await readFile(path)
    const signal = new AbortController().signal
    const fileId = await uploadVoiceCloneFile(transport, {
      filename: work.file,
      bytes,
    }, signal)
    const voiceId = MediaVoiceId(createCloneVoiceId())
    await cloneVoice(transport, fileId, voiceId, signal)
    const record: MediaVoiceRecord = {
      voiceId,
      label,
      system: false,
      digest,
      consentAt: this.timestamp(),
      speakerIsUser: consent.speakerIsUser,
      requestId: request.requestId,
    }
    await upsertVoice(record)
    return { voiceId }
  }

  /**
   * Join approved clips and optional narration.
   * @param owner - live agent.
   * @param clipIds - artifact ids in join order.
   * @param narrationId - optional narration artifact.
   * @param mix - mix instead of replace.
   * @returns composed artifact.
   */
  async compose(
    owner: Agent,
    clipIds: readonly string[],
    narrationId: string | undefined,
    mix: boolean,
  ): Promise<MediaArtifactRecord> {
    if (clipIds.length === 0 || clipIds.length > this.config.maxClipCount) {
      throw new MediaError('clips-empty', 'compose needs 1 to maxClipCount clips')
    }
    const signal = new AbortController().signal
    const status = await this.runtimeStatus(signal)
    if (!status.ready) throw new MediaError('runtime-unready', status.guidance)
    const home = await tryResolveMediaRuntimeHome(this.config)
    if (home === undefined) throw new MediaError('runtime-missing', status.guidance)
    const clips = []
    for (const id of clipIds) {
      const work = await findWork(id)
      if (work === undefined) throw new MediaError('artifact-missing', 'compose clip is not registered')
      clips.push({ id, path: artifactFilePath(work.artifactId, work.file) })
    }
    let narration: { path: string } | undefined
    if (narrationId !== undefined) {
      const work = await findWork(narrationId)
      if (work === undefined) throw new MediaError('artifact-missing', 'narration is not registered')
      narration = { path: artifactFilePath(work.artifactId, work.file) }
    }
    const artifactId = MediaArtifactId(mintMediaId('a'))
    const request = this.requestRecord({
      kind: 'composed',
      label: 'compose',
      estimatedYuan: 0,
      stage: 'composed',
      artifactId,
    })
    const destDir = join(resolveMediaHome(), 'files', artifactId)
    await mkdir(destDir, { recursive: true })
    const outputPath = join(destDir, 'result.mp4')
    const compose = this.internals.compose ?? composeAudiovisual
    await compose({
      clips,
      outputPath,
      binaries: mediaRuntimeBinaries(home),
      run: runNativeCommand,
      signal,
      ...narration === undefined ? {} : { narration, mixOriginalAudio: mix },
    })
    const digest = await sha256File(outputPath)
    const artifact: MediaArtifactRecord = {
      artifactId,
      requestId: request.requestId,
      kind: 'composed',
      name: '合成.mp4',
      file: 'result.mp4',
      digest,
      sessionId: owner.session.id,
      createdAt: this.timestamp(),
      ...await this.inheritedWorkspace(owner.session.id),
    }
    await appendMediaEvent(owner, 'media/request', { version: 1, request }, this.sessionFlush())
    await appendMediaEvent(owner, 'media/artifact', { version: 1, artifact }, this.sessionFlush())
    await upsertWork(artifact)
    return artifact
  }

  /**
   * Recover known provider tasks for a newly created live agent.
   * @param owner - live agent.
   * @returns started job ids.
   */
  recover(owner: Agent): readonly JobId[] {
    const jobs = this.seam<JobRegistry>('jobs')
    if (jobs === undefined) return []
    return recoverMediaJobs(
      jobs,
      owner,
      this.projectionOf(owner),
      (request, signal) => {
        if (request.kind === 'video' && request.providerTaskId !== undefined) {
          return this.resumeVideo(owner, request, request.providerTaskId, signal)
        }
        return Promise.resolve('nothing to recover')
      },
      request => appendMediaEvent(owner, 'media/stop', {
        version: 1,
        requestId: request.requestId,
      }, this.sessionFlush()),
    )
  }

  /**
   * Estimate used when the provider does not return a charge.
   * @param kind - paid operation.
   * @returns yuan estimate.
   */
  estimateYuan(kind: 'video' | 'speech' | 'clone'): number {
    if (kind === 'video') return ESTIMATE_VIDEO_YUAN
    if (kind === 'speech') return ESTIMATE_TTS_YUAN
    return ESTIMATE_CLONE_YUAN
  }

  private async resolveWorkPath(artifactId: string): Promise<string> {
    const work = await findWork(artifactId)
    if (work === undefined) throw new MediaError('artifact-missing', 'work is not registered')
    return artifactFilePath(work.artifactId, work.file)
  }

  private projectionOf(owner: Agent): MediaProjectionState {
    const projections = this.seam<{
      stateOf: (session: Agent['session'], key: 'media') => MediaProjectionState | undefined
    }>('sessionProjections')
    if (projections === undefined) return emptyMediaState()
    const state = projections.stateOf(owner.session, 'media')
    if (state === undefined) return emptyMediaState()
    return state
  }

  private seam<T>(name: string): T | undefined {
    return optionalHostSeam<T>(this.ctx, name)
  }

  private sessionFlush(): SessionFlush | undefined {
    const injected = this.internals.flush
    if (injected !== undefined) return injected
    const sessions = this.seam<{ flush: SessionFlush }>('sessions')
    if (sessions?.flush === undefined) return undefined
    return sessions.flush.bind(sessions)
  }

  private approvedRequest(
    state: MediaProjectionState,
    approval: MediaApprovalInput,
    partial: {
      kind: MediaWorkKind
      label: string
      model: string
    },
  ): MediaRequestRecord {
    const inputHashes = approval.inputHashes ?? []
    if (approval.requestId !== undefined) {
      const existing = state.requests[approval.requestId]
      if (existing === undefined) {
        throw new MediaError('approval-required', 'approved request is not in the session')
      }
      assertApprovalMatches(existing, {
        requestId: existing.requestId,
        inputHashes,
        promptHash: approval.promptHash,
        estimatedYuan: approval.estimatedYuan,
      })
      return {
        ...existing,
        stage: 'approved',
        promptHash: approval.promptHash,
        inputHashes,
        estimatedYuan: approval.estimatedYuan,
      }
    }
    return this.requestRecord({
      kind: partial.kind,
      label: partial.label,
      estimatedYuan: approval.estimatedYuan,
      stage: 'approved',
      inputHashes,
      promptHash: approval.promptHash,
      model: partial.model,
    })
  }

  private startOwnedJob(
    owner: Agent,
    label: string,
    requestId: MediaRequestId,
    work: (signal: AbortSignal) => Promise<string>,
  ): JobId {
    const jobs = this.seam<JobRegistry>('jobs')
    if (jobs === undefined) throw new MediaError('task-failed', 'background jobs are unavailable')
    try {
      return startMediaJob({
        jobs,
        owner: owner.session.id,
        label,
        work,
        onStop: () => appendMediaEvent(owner, 'media/stop', { version: 1, requestId }, this.sessionFlush()),
      })
    } catch (error: unknown) {
      if (isMissingJobController(error)) {
        throw new MediaError('task-failed', 'background jobs are unavailable')
      }
      throw error
    }
  }

  private async inheritedWorkspace(sessionId: string): Promise<{ workspaceId: string } | Record<string, never>> {
    const existing = await listWorks({ sessionId })
    const workspaceId = existing.find(row => row.workspaceId !== undefined)?.workspaceId
    return workspaceId === undefined ? {} : { workspaceId }
  }

  private async resolveVideoImages(
    imageIds: readonly string[] | undefined,
    imageMode: 'reference' | 'first_last' | undefined,
  ): Promise<readonly VideoImageInput[]> {
    if (imageIds === undefined || imageIds.length === 0) return []
    if (imageMode === 'first_last' && imageIds.length !== 2) {
      throw new MediaError('image-mode-conflict', 'first/last-frame mode needs exactly two images')
    }
    const images: VideoImageInput[] = []
    for (const [index, id] of imageIds.entries()) {
      const work = await findWork(id)
      if (work === undefined) throw new MediaError('artifact-missing', 'video image is not registered')
      const role = imageMode === 'first_last'
        ? index === 0 ? 'first_frame' : 'last_frame'
        : 'reference'
      const { readFile } = await import('node:fs/promises')
      const bytes = await readFile(artifactFilePath(work.artifactId, work.file))
      images.push({
        role,
        mediaType: imageMediaType(work.name),
        bytes,
      })
    }
    return images
  }

  private requestRecord(partial: {
    kind: MediaWorkKind
    label: string
    estimatedYuan: number
    stage: MediaRequestRecord['stage']
    model?: string
    promptHash?: string
    artifactId?: MediaArtifactId
    inputHashes?: readonly string[]
  }): MediaRequestRecord {
    return {
      requestId: MediaRequestId(mintMediaId('r')),
      kind: partial.kind,
      stage: partial.stage,
      label: partial.label,
      inputHashes: partial.inputHashes ?? [],
      estimatedYuan: partial.estimatedYuan,
      ...partial.model === undefined ? {} : { model: partial.model },
      ...partial.promptHash === undefined ? {} : { promptHash: partial.promptHash },
      ...partial.artifactId === undefined ? {} : { artifactId: partial.artifactId },
    }
  }

  private async transport(): Promise<MinimaxTransport> {
    if (this.internals.transport !== undefined) return this.internals.transport
    const credentials = this.internals.credentials
      ?? this.seam<MinimaxCredentialLookup>('credentials')
    if (credentials === undefined) {
      throw new MediaError('credential-missing', 'MINIMAX_API_KEY is not configured')
    }
    const apiKey = await resolveMinimaxApiKey(credentials, MINIMAX_API_KEY_REF)
    return createMinimaxTransport({ apiKey })
  }

  private async runVideo(
    owner: Agent,
    request: MediaRequestRecord,
    args: CreateVideoArgs,
    images: readonly VideoImageInput[],
    signal: AbortSignal,
  ): Promise<string> {
    let resolved = images
    if (args.imageIds !== undefined && args.imageIds.length > 0) {
      resolved = await this.resolveVideoImages(args.imageIds, args.imageMode)
      const hashes = resolved.map(image => sha256Bytes(image.bytes))
      if (!sameHashSet(hashes, request.inputHashes)) {
        throw new MediaError('approval-mismatch', 'image bytes changed after approval')
      }
    }
    const transport = await this.transport()
    const taskId = await createVideoTask(transport, {
      model: args.model,
      prompt: args.prompt,
      resolution: args.resolution,
      duration: args.duration,
      ratio: args.ratio,
      ...resolved.length === 0 ? {} : { images: resolved },
    }, signal)
    await appendMediaEvent(owner, 'media/task', {
      version: 1, requestId: request.requestId, providerTaskId: taskId,
    }, this.sessionFlush())
    return this.resumeVideo(owner, request, taskId, signal)
  }

  private async resumeVideo(
    owner: Agent,
    request: MediaRequestRecord,
    taskId: string,
    signal: AbortSignal,
  ): Promise<string> {
    const transport = await this.transport()
    const task = await waitForVideoTask(transport, taskId, signal, {
      intervalMs: this.config.pollIntervalMs,
      timeoutMs: this.config.pollTimeoutMs,
    })
    const artifactId = MediaArtifactId(mintMediaId('a'))
    const destDir = join(resolveMediaHome(), 'files', artifactId)
    await mkdir(destDir, { recursive: true })
    const destPath = join(destDir, 'result.mp4')
    if (task.downloadUrl === undefined) throw new MediaError('provider-invalid', 'video task has no download URL')
    await downloadProviderFile(transport, task.downloadUrl, destPath, signal)
    const digest = await sha256File(destPath)
    const artifact: MediaArtifactRecord = {
      artifactId,
      requestId: request.requestId,
      kind: 'video',
      name: '样片.mp4',
      file: 'result.mp4',
      digest,
      sessionId: owner.session.id,
      createdAt: this.timestamp(),
      ...await this.inheritedWorkspace(owner.session.id),
    }
    await appendMediaEvent(owner, 'media/artifact', { version: 1, artifact }, this.sessionFlush())
    await upsertWork(artifact)
    return `request ${request.requestId} artifact ${artifactId}`
  }

  private async runSpeech(
    owner: Agent,
    request: MediaRequestRecord,
    text: string,
    voiceId: string,
    signal: AbortSignal,
  ): Promise<string> {
    const transport = await this.transport()
    const result = await synthesizeSpeech(transport, {
      model: this.config.ttsModel,
      text,
      voiceId,
    }, signal)
    const artifactId = MediaArtifactId(mintMediaId('a'))
    const destDir = join(resolveMediaHome(), 'files', artifactId)
    await mkdir(destDir, { recursive: true })
    const destPath = join(destDir, 'speech.mp3')
    await writeFile(destPath, result.audio)
    const digest = sha256Bytes(result.audio)
    const artifact: MediaArtifactRecord = {
      artifactId,
      requestId: request.requestId,
      kind: 'speech',
      name: '配音.mp3',
      file: 'speech.mp3',
      digest,
      sessionId: owner.session.id,
      createdAt: this.timestamp(),
      ...await this.inheritedWorkspace(owner.session.id),
    }
    await appendMediaEvent(owner, 'media/artifact', { version: 1, artifact }, this.sessionFlush())
    await upsertWork(artifact)
    const voices = await listVoices()
    const used = voices.find(row => row.voiceId === voiceId)
    if (used !== undefined) {
      await upsertVoice({ ...used, lastFormalAt: this.timestamp() })
    }
    return `request ${request.requestId} artifact ${artifactId}`
  }

  private timestamp(): string {
    return (this.internals.now ?? (() => new Date()))().toISOString()
  }
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code: unknown }).code === 'ENOENT'
}
