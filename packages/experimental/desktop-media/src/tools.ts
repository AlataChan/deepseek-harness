/**
 * Model-facing media tools.
 * @module @deepseek-ai/dsh-experimental-desktop-media/tools
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ESTIMATE_CLONE_YUAN, ESTIMATE_TTS_YUAN, ESTIMATE_VIDEO_YUAN } from './budget.ts'
import { MediaError } from './error.ts'
import type { DesktopMedia } from './service.ts'

/**
 * SHA-256 of one prompt string.
 * @param text - approved copy.
 * @returns hex digest.
 */
export function hashPrompt(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Register media tools. Disposed with the plugin fiber.
 * @param ctx - Host context.
 * @param media - overlay service.
 * @returns disposer.
 */
export function registerMediaTools(ctx: Context, media: DesktopMedia): () => void {
  const tools = ctx.get('tools')
  if (tools === undefined) return () => {}

  const video = tools.register(defineTool({
    name: 'media_create_video',
    description:
      'Submit one short MiniMax video after the user confirms the paid proposal. Returns request and job ids.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'One-shot visual prompt.' },
      duration: { type: 'integer', description: 'Seconds. Default 5.' },
      ratio: { type: 'string', description: 'Frame ratio such as 16:9.' },
      resolution: { type: 'string', description: '480P or 768P.' },
      approvedRequestId: { type: 'string', description: 'Existing approved request to recheck.' },
      imageIds: {
        type: 'array',
        items: { type: 'string', description: 'Registered still artifact id.' },
        description: 'Imported photos for image-to-video or first/last frames.',
      },
      imageMode: { type: 'string', description: 'reference (default) or first_last.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          requestId: { type: 'string', required: true },
          jobId: { type: 'string', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: `started video request ${value.requestId} job ${value.jobId}` }]
      },
      presentationMeta(_args, value) {
        return { requestId: value.requestId, jobId: value.jobId, kind: 'video' }
      },
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new MediaError('task-failed', 'media tools require a live agent')
      await askConfirm(ctx, exec.agent, '确认付费生成这段视频？', `约 ¥${ESTIMATE_VIDEO_YUAN}`)
      const created = await media.createVideo(exec.agent, {
        prompt: args.prompt,
        duration: typeof args.duration === 'number' ? args.duration : media.config.defaultDurationSeconds,
        ratio: (args.ratio as DesktopMedia['config']['defaultRatio'] | undefined) ?? media.config.defaultRatio,
        resolution: (args.resolution as DesktopMedia['config']['defaultResolution'] | undefined)
          ?? media.config.defaultResolution,
        model: media.config.videoModel,
        ...args.imageIds === undefined ? {} : { imageIds: args.imageIds },
        ...args.imageMode === 'first_last' ? { imageMode: 'first_last' as const } : {},
      }, {
        promptHash: hashPrompt(args.prompt),
        estimatedYuan: ESTIMATE_VIDEO_YUAN,
        ...args.approvedRequestId === undefined ? {} : { requestId: args.approvedRequestId },
      })
      return { requestId: created.requestId, jobId: created.jobId }
    },
  }))

  const speech = tools.register(defineTool({
    name: 'media_synthesize_speech',
    description: 'Synthesize narration after the user confirms copy and voice. Returns request and job ids.',
    parameters: {
      text: { type: 'string', required: true, description: 'Narration copy.' },
      voiceId: { type: 'string', required: true, description: 'System or cloned voice id.' },
      approvedRequestId: { type: 'string', description: 'Existing approved request to recheck.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          requestId: { type: 'string', required: true },
          jobId: { type: 'string', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: `started speech request ${value.requestId} job ${value.jobId}` }]
      },
      presentationMeta(_args, value) {
        return { requestId: value.requestId, jobId: value.jobId, kind: 'speech' }
      },
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new MediaError('task-failed', 'media tools require a live agent')
      await askConfirm(ctx, exec.agent, '确认付费合成这段配音？', `约 ¥${ESTIMATE_TTS_YUAN}`)
      const created = await media.createSpeech(
        exec.agent,
        args.text,
        args.voiceId,
        {
          promptHash: hashPrompt(args.text),
          estimatedYuan: ESTIMATE_TTS_YUAN,
          ...args.approvedRequestId === undefined ? {} : { requestId: args.approvedRequestId },
        },
      )
      return { requestId: created.requestId, jobId: created.jobId }
    },
  }))

  const clone = tools.register(defineTool({
    name: 'media_clone_voice',
    description: 'Clone a voice from a registered import after explicit consent. Does not substitute a system voice.',
    parameters: {
      artifactId: { type: 'string', required: true, description: 'Registered sample artifact.' },
      label: { type: 'string', required: true, description: 'Display name.' },
      speakerIsUser: { type: 'boolean', required: true, description: 'True when the speaker is the user.' },
      authorized: { type: 'boolean', required: true, description: 'True when upload is authorized.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          voiceId: { type: 'string', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: `cloned voice ${value.voiceId}` }]
      },
      presentationMeta(_args, value) {
        return { voiceId: value.voiceId, kind: 'clone' }
      },
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new MediaError('task-failed', 'media tools require a live agent')
      await askConfirm(ctx, exec.agent, '确认上传这段录音做声音克隆？', `约 ¥${ESTIMATE_CLONE_YUAN}`)
      const created = await media.cloneVoiceFromArtifact(exec.agent, args.artifactId, args.label, {
        speakerIsUser: args.speakerIsUser,
        authorized: args.authorized,
      })
      return { voiceId: created.voiceId }
    },
  }))

  const compose = tools.register(defineTool({
    name: 'media_compose',
    description: 'Join approved clips and optional narration. Narration replaces original audio unless mix is true.',
    parameters: {
      clipIds: {
        type: 'array',
        required: true,
        items: { type: 'string', description: 'Registered clip artifact id.' },
        description: 'Clips in join order.',
      },
      narrationId: { type: 'string', description: 'Registered narration artifact.' },
      mix: { type: 'boolean', description: 'Mix narration with original audio.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          artifactId: { type: 'string', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: `composed artifact ${value.artifactId}` }]
      },
      presentationMeta(_args, value) {
        return { artifactId: value.artifactId, kind: 'composed' }
      },
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new MediaError('task-failed', 'media tools require a live agent')
      const artifact = await media.compose(
        exec.agent,
        args.clipIds,
        args.narrationId,
        args.mix === true,
      )
      return { artifactId: artifact.artifactId }
    },
  }))

  return () => {
    video()
    speech()
    clone()
    compose()
  }
}

/**
 * Ask the user to confirm a paid call. Absence of userQuestions fails closed.
 * @param ctx - Host context.
 * @param agent - live owner.
 * @param question - confirmation prompt.
 * @param detail - spend estimate.
 */
export async function askConfirm(
  ctx: Context,
  agent: Agent,
  question: string,
  detail: string,
): Promise<void> {
  const questions = ctx.get('userQuestions')
  if (questions === undefined) {
    throw new MediaError('approval-required', 'paid media calls require userQuestions')
  }
  const answer = await questions.ask({
    agent,
    questions: [{
      id: 'media-confirm',
      question,
      detail,
      options: [{ label: '确认' }, { label: '取消' }],
    }],
  })
  if (answer.answers[0]?.selected[0] !== '确认') {
    throw new MediaError('approval-required', 'user declined the paid media call')
  }
}
