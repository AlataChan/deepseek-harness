/** Authorized MiniMax H3, formal TTS, and clone. retry:0 so a failure is not billed three times. */

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  CredentialProvider,
  credentialRef,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import {
  cloneVoice,
  createCloneVoiceId,
  createMinimaxTransport,
  createVideoTask,
  downloadProviderFile,
  queryVideoTask,
  resolveMinimaxApiKey,
  synthesizeSpeech,
  uploadVoiceCloneFile,
  waitForVideoTask,
} from '../src/provider.ts'

const paid = process.env.MINIMAX_E2E_ALLOW_PAID === '1'
const hasKey = (process.env.MINIMAX_API_KEY ?? '').trim() !== ''

class EnvMinimaxCredentials extends CredentialProvider {
  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = process.env[ref]?.trim() ?? ''
    return Promise.resolve(value === '' ? undefined : { value, source: 'env' })
  }

  override describe(ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({
      configured: (process.env[ref] ?? '').trim() !== '',
      writable: false,
      ...((process.env[ref] ?? '').trim() !== '' ? { source: 'env' } : {}),
    })
  }

  override set(): Promise<void> {
    return Promise.reject(new Error('e2e credentials are read-only'))
  }

  override unset(): Promise<void> {
    return Promise.reject(new Error('e2e credentials are read-only'))
  }

  override readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(undefined)
  }

  override describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return Promise.resolve({ configured: false, writable: false })
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([])
  }

  override modifyRecord(): Promise<CredentialRecord | undefined> {
    return Promise.reject(new Error('e2e credentials are read-only'))
  }

  override deleteRecord(): Promise<void> {
    return Promise.reject(new Error('e2e credentials are read-only'))
  }
}

async function paidTransport() {
  const ctx = new Context()
  await ctx.plugin(EnvMinimaxCredentials)
  const apiKey = await resolveMinimaxApiKey(ctx.credentials, credentialRef('MINIMAX_API_KEY'))
  return createMinimaxTransport({
    apiKey,
    ...(process.env.MINIMAX_BASE_URL ? { baseUrl: process.env.MINIMAX_BASE_URL } : {}),
  })
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const EVIDENCE = '/tmp/desktop-media-minimax-e2e.jsonl'

async function recordEvidence(row: Record<string, unknown>): Promise<void> {
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`
  await writeFile(EVIDENCE, line, { flag: 'a' })
  console.log(line.trim())
}

describe.skipIf(!paid || !hasKey)('MiniMax paid Stage 1', () => {
  it('synthesizes formal system-voice speech', { retry: 0, timeout: 120_000 }, async () => {
    const transport = await paidTransport()
    const spoken = await synthesizeSpeech(transport, {
      model: 'speech-2.8-hd',
      text: '绿鲸在浅海沙滩上放下一只杯子。',
      voiceId: 'male-qn-qingse',
    }, new AbortController().signal)
    expect(spoken.audio.byteLength).toBeGreaterThan(100)
    expect(spoken.usageCharacters).toBeGreaterThan(0)
    await recordEvidence({
      op: 'tts-system',
      model: 'speech-2.8-hd',
      voiceId: 'male-qn-qingse',
      usageCharacters: spoken.usageCharacters,
      durationMs: spoken.durationMs,
      bytes: spoken.audio.byteLength,
      sha256: digest(spoken.audio),
    })
  })

  it('creates MiniMax-H3-Max text-to-video, waits, and downloads', { retry: 0, timeout: 600_000 }, async () => {
    const transport = await paidTransport()
    const signal = new AbortController().signal
    const taskId = await createVideoTask(transport, {
      model: 'MiniMax-H3-Max',
      prompt: 'A still shot of a green ceramic cup on a wooden table, soft daylight, no people, no text.',
      resolution: '768P',
      duration: 5,
      ratio: '16:9',
      promptExpansionMode: 'disabled',
    }, signal)
    expect(taskId.length).toBeGreaterThan(0)
    const task = await waitForVideoTask(transport, taskId, signal, {
      intervalMs: 5_000,
      timeoutMs: 540_000,
    })
    expect(task.status).toBe('succeeded')
    expect(task.downloadUrl).toBeTruthy()
    const root = await mkdtemp(join(tmpdir(), 'desktop-media-h3-'))
    const dest = join(root, 'h3-max.mp4')
    await downloadProviderFile(transport, task.downloadUrl!, dest, signal)
    const bytes = await readFile(dest)
    expect(bytes.byteLength).toBeGreaterThan(1000)
    const requery = await queryVideoTask(transport, taskId, signal)
    expect(requery.status).toBe('succeeded')
    await recordEvidence({
      op: 'h3-max-t2v',
      model: task.model || 'MiniMax-H3-Max',
      resolution: '768P',
      duration: 5,
      ratio: '16:9',
      taskIdTail: taskId.slice(-4),
      outputSeconds: task.outputSeconds,
      bytes: bytes.byteLength,
      sha256: digest(bytes),
      requeryStatus: requery.status,
    })
  })

  it('clones a synthetic sample and runs first formal TTS on that voice', { retry: 0, timeout: 180_000 }, async () => {
    const transport = await paidTransport()
    const signal = new AbortController().signal
    const sample = await synthesizeSpeech(transport, {
      model: 'speech-2.8-hd',
      text: '这是一段仅用于接口连通性检查的合成旁白。浅海沙滩上的杯子没有商标，也没有人名。我们把句子说得足够长，好让音频超过十秒，满足声音复刻最短时长。请忽略语义，只保留平稳的朗读节奏。',
      voiceId: 'male-qn-qingse',
    }, signal)
    expect((sample.durationMs ?? 0) >= 10_000 || sample.audio.byteLength > 8_000).toBe(true)
    const root = await mkdtemp(join(tmpdir(), 'desktop-media-clone-'))
    const samplePath = join(root, 'clone-source.mp3')
    await writeFile(samplePath, sample.audio)
    const fileId = await uploadVoiceCloneFile(transport, {
      filename: 'clone-source.mp3',
      bytes: sample.audio,
    }, signal)
    const voiceId = createCloneVoiceId()
    await cloneVoice(transport, fileId, voiceId, signal)
    const firstFormal = await synthesizeSpeech(transport, {
      model: 'speech-2.8-hd',
      text: '克隆后的第一句正式配音。',
      voiceId,
    }, signal)
    expect(firstFormal.audio.byteLength).toBeGreaterThan(100)
    await recordEvidence({
      op: 'clone-then-first-tts',
      sampleUsageCharacters: sample.usageCharacters,
      sampleDurationMs: sample.durationMs,
      sampleBytes: sample.audio.byteLength,
      voiceIdPrefix: voiceId.slice(0, 6),
      firstFormalUsageCharacters: firstFormal.usageCharacters,
      firstFormalDurationMs: firstFormal.durationMs,
      firstFormalBytes: firstFormal.audio.byteLength,
      firstFormalSha256: digest(firstFormal.audio),
    })
  })
})
