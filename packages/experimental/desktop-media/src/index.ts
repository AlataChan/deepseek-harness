/**
 * Dual-face Host plugin for conversation-driven media creation.
 * @module @deepseek-ai/dsh-experimental-desktop-media
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MEDIA_CREATION_PROMPT } from './prompt.ts'
import { mediaProjectionDefinition } from './projection.ts'
import { DesktopMedia, optionalHostSeam, type DesktopMediaConfig } from './service.ts'
import { registerMediaTools } from './tools.ts'
import { resolveMediaRuntimeHome } from './media-home.ts'
import type {} from './types.ts'

export { MediaError, type MediaErrorCode } from './error.ts'
export {
  mediaHomeDisplay,
  mediaRuntimeBinaries,
  readUserRuntimeHome,
  readUserRuntimeHomeSync,
  resolveMediaHome,
  resolveMediaRuntimeHome,
  tryResolveMediaRuntimeHome,
  writeUserRuntimeHome,
  USER_RUNTIME_HOME_FILE,
  type MediaRuntimeHomeConfig,
} from './media-home.ts'
export {
  assertEncodersAvailable,
  assertShippableFfmpeg,
  assertUserRuntimeReady,
  DEFAULT_AUDIO_ENCODER,
  DEFAULT_VIDEO_ENCODER,
  inspectFfmpegLicense,
  inspectFfmpegVersionOutput,
  type FfmpegLicenseReport,
} from './runtime.ts'
export {
  composeAudiovisual,
  parseProbe,
  probeMedia,
  type ComposeBinaries,
  type ComposeClip,
  type ComposeNarration,
  type ComposeRequest,
  type ComposeResult,
  type MediaProbe,
} from './compositor.ts'
export {
  assertAbsoluteMediaPath,
  assertExistingMediaFile,
  canOpenMediaFile,
  openMediaFile,
  revealMediaFile,
  SYSTEM_OPEN_REQUESTED,
  type MediaOpenInternals,
} from './local-open.ts'
export {
  cloneVoice,
  createCloneVoiceId,
  createMinimaxTransport,
  createVideoTask,
  decodeHexAudio,
  DEFAULT_MINIMAX_BASE_URL,
  downloadProviderFile,
  MINIMAX_API_KEY_REF,
  queryVideoTask,
  resolveMinimaxApiKey,
  synthesizeSpeech,
  uploadVoiceCloneFile,
  waitForVideoTask,
} from './provider.ts'
export {
  DesktopMedia,
  optionalHostSeam,
  type DesktopMediaConfig,
  type MediaApprovalInput,
  type MediaRuntimeStatus,
} from './service.ts'
export { applyMediaEvent, emptyMediaState, mediaProjectionDefinition } from './projection.ts'
export { hashPrompt, registerMediaTools } from './tools.ts'
export { recoverMediaJobs, recoverableRequests } from './recovery.ts'
export { spentBudget, assertBudgetAllows, ESTIMATE_VIDEO_YUAN } from './budget.ts'
export { assertApprovalMatches, sameHashSet } from './approval.ts'
export { classifyImportName, assertImportSize, admitImportBytes, imageMediaType } from './admission.ts'
export { listWorks, upsertWork, findWork, listVoices } from './catalogue.ts'
export { MEDIA_CREATION_PROMPT } from './prompt.ts'
export { startMediaJob, mediaJobHooks, isMissingJobController } from './jobs.ts'

/** Cordis plugin name. */
export const name = 'experimental-desktop-media'

/** Wait for Host seams that register tools, jobs, projection, prompt, and flush. Other seams stay optional via `ctx.get`. */
export const inject = ['tools', 'jobs', 'sessionProjections', 'systemPrompt', 'sessions']

/** Runtime validation for {@link DesktopMediaConfig}. */
export const Config: z<DesktopMediaConfig> = z.object({
  mediaRuntimePath: z.string().default(''),
  maxPaidCallsPerSession: z.natural().default(8),
  maxEstimatedSpendYuan: z.number().default(40),
  maxClipCount: z.natural().default(4),
  maxClipDurationSeconds: z.natural().default(15),
  maxFileBytes: z.natural().default(20 * 1024 * 1024),
  pollIntervalMs: z.natural().default(4000),
  pollTimeoutMs: z.natural().default(600_000),
  videoModel: z.string().default('MiniMax-H3-Max'),
  ttsModel: z.string().default('speech-2.8-hd'),
  defaultDurationSeconds: z.natural().default(5),
  defaultResolution: z.string().default('768P'),
  defaultRatio: z.string().default('16:9'),
}) as z<DesktopMediaConfig>

/**
 * Load the media service, projection, tools, prompt, and recovery listener.
 * @param ctx - Host context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: DesktopMediaConfig): void {
  if ((config.mediaRuntimePath ?? '').trim() !== '') resolveMediaRuntimeHome(config)
  const media = new DesktopMedia(ctx, config)
  const projections = optionalHostSeam<{ register: (definition: typeof mediaProjectionDefinition) => () => void }>(
    ctx,
    'sessionProjections',
  )
  if (projections !== undefined) {
    ctx.effect(() => projections.register(mediaProjectionDefinition), 'desktop-media.projection')
  }
  const systemPrompt = optionalHostSeam<{
    section: (entry: { name: string; order: number; text: () => string }) => () => void
  }>(ctx, 'systemPrompt')
  if (systemPrompt !== undefined) {
    ctx.effect(() => systemPrompt.section({
      name: 'desktop-media:creation',
      order: 92,
      text: () => MEDIA_CREATION_PROMPT,
    }), 'desktop-media.prompt')
  }
  ctx.effect(() => registerMediaTools(ctx, media), 'desktop-media.tools')
  ctx.on('agent/created', ({ agent }: { agent: Agent }) => {
    media.recover(agent)
  })
}
