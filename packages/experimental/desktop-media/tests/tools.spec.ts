import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { MediaError } from '../src/error.ts'
import type { DesktopMedia } from '../src/service.ts'
import { askConfirm, hashPrompt, registerMediaTools } from '../src/tools.ts'

function agent(): Agent {
  return { session: { id: 's-1', append() {} } } as unknown as Agent
}

function mediaStub(overrides: Partial<DesktopMedia> = {}): DesktopMedia {
  return {
    config: {
      defaultDurationSeconds: 5,
      defaultRatio: '16:9',
      defaultResolution: '768P',
      videoModel: 'MiniMax-H3-Max',
    },
    createVideo: vi.fn(async () => ({ requestId: 'r_v', jobId: 'j_v' })),
    createSpeech: vi.fn(async () => ({ requestId: 'r_s', jobId: 'j_s' })),
    cloneVoiceFromArtifact: vi.fn(async () => ({ voiceId: 'v_1' })),
    compose: vi.fn(async () => ({ artifactId: 'a_1' })),
    ...overrides,
  } as unknown as DesktopMedia
}

function exec(owner?: Agent) {
  return { agent: owner, signal: new AbortController().signal } as never
}

describe('tools', () => {
  it('hashes prompts and no-ops when tools are absent', () => {
    expect(hashPrompt('hello')).toMatch(/^[0-9a-f]{64}$/)
    const dispose = registerMediaTools(new Context(), mediaStub())
    dispose()
  })

  it('registers, presents, executes, and disposes the four tools', async () => {
    const ctx = new Context()
    const registered: ToolDefinition[] = []
    ctx.provide('tools', {
      register(definition: ToolDefinition) {
        registered.push(definition)
        return () => {
          const index = registered.indexOf(definition)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    })
    const media = mediaStub()
    const dispose = registerMediaTools(ctx, media)
    expect(registered.map(row => row.name)).toEqual([
      'media_create_video',
      'media_synthesize_speech',
      'media_clone_voice',
      'media_compose',
    ])

    const [video, speech, clone, compose] = registered as [
      ToolDefinition, ToolDefinition, ToolDefinition, ToolDefinition,
    ]
    expect(video.output.render({}, { requestId: 'r', jobId: 'j' })).toEqual([
      { type: 'text', text: 'started video request r job j' },
    ])
    expect(video.output.presentationMeta!({}, { requestId: 'r', jobId: 'j' }))
      .toEqual({ requestId: 'r', jobId: 'j', kind: 'video' })
    expect(speech.output.render({}, { requestId: 'r', jobId: 'j' })).toEqual([
      { type: 'text', text: 'started speech request r job j' },
    ])
    expect(speech.output.presentationMeta!({}, { requestId: 'r', jobId: 'j' }))
      .toEqual({ requestId: 'r', jobId: 'j', kind: 'speech' })
    expect(clone.output.render({}, { voiceId: 'v' })).toEqual([
      { type: 'text', text: 'cloned voice v' },
    ])
    expect(clone.output.presentationMeta!({}, { voiceId: 'v' }))
      .toEqual({ voiceId: 'v', kind: 'clone' })
    expect(compose.output.render({}, { artifactId: 'a' })).toEqual([
      { type: 'text', text: 'composed artifact a' },
    ])
    expect(compose.output.presentationMeta!({}, { artifactId: 'a' }))
      .toEqual({ artifactId: 'a', kind: 'composed' })

    await expect(video.execute({ prompt: 'shot' }, exec())).rejects.toMatchObject({
      code: 'task-failed',
    })
    await expect(speech.execute({ text: 'hi', voiceId: 'v' }, exec())).rejects.toMatchObject({
      code: 'task-failed',
    })
    await expect(clone.execute({
      artifactId: 'a', label: 'mine', speakerIsUser: true, authorized: true,
    }, exec())).rejects.toMatchObject({ code: 'task-failed' })
    await expect(compose.execute({ clipIds: ['a'] }, exec())).rejects.toMatchObject({
      code: 'task-failed',
    })

    const owner = agent()
    await expect(video.execute({ prompt: 'shot' }, exec(owner))).rejects.toMatchObject({
      code: 'approval-required',
    })
    ctx.provide('userQuestions', {
      ask: async () => ({ answers: [{ selected: ['确认'] }] }),
    })
    await expect(video.execute({ prompt: 'shot' }, exec(owner))).resolves.toEqual({
      requestId: 'r_v', jobId: 'j_v',
    })
    await expect(video.execute({
      prompt: 'shot',
      duration: 6,
      ratio: '9:16',
      resolution: '480P',
      approvedRequestId: 'r_keep',
      imageIds: ['a_img'],
      imageMode: 'first_last',
    }, exec(owner))).resolves.toEqual({ requestId: 'r_v', jobId: 'j_v' })
    await expect(speech.execute({ text: 'hi', voiceId: 'v' }, exec(owner))).resolves.toEqual({
      requestId: 'r_s', jobId: 'j_s',
    })
    await expect(speech.execute({
      text: 'hi',
      voiceId: 'v',
      approvedRequestId: 'r_keep',
    }, exec(owner))).resolves.toEqual({ requestId: 'r_s', jobId: 'j_s' })
    await expect(clone.execute({
      artifactId: 'a', label: 'mine', speakerIsUser: true, authorized: true,
    }, exec(owner))).resolves.toEqual({ voiceId: 'v_1' })
    await expect(compose.execute({ clipIds: ['a'] }, exec(owner))).resolves.toEqual({
      artifactId: 'a_1',
    })
    await expect(compose.execute({
      clipIds: ['a'],
      narrationId: 'n',
      mix: true,
    }, exec(owner))).resolves.toEqual({ artifactId: 'a_1' })

    dispose()
    expect(registered).toEqual([])
  })

  it('asks for paid confirmation and fails closed without userQuestions', async () => {
    const owner = agent()
    const empty = new Context()
    await expect(askConfirm(empty, owner, '确认？', '约 ¥1')).rejects.toMatchObject({
      code: 'approval-required',
    })

    const ok = new Context()
    ok.provide('userQuestions', {
      ask: async () => ({ answers: [{ selected: ['确认'] }] }),
    })
    await askConfirm(ok, owner, '确认？', '约 ¥1')

    const no = new Context()
    no.provide('userQuestions', {
      ask: async () => ({ answers: [{ selected: ['取消'] }] }),
    })
    await expect(askConfirm(no, owner, '确认？', '约 ¥1')).rejects.toBeInstanceOf(MediaError)
  })
})
