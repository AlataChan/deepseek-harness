/** Transcript document formatting. */
import { describe, expect, it } from 'vitest'
import { formatClock, formatDate, formatInference, renderTranscript } from '../src/transcript.ts'

describe('transcript formatting', () => {
  it('formats clocks as minutes:seconds without wrapping minutes', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(5)).toBe('0:05')
    expect(formatClock(90)).toBe('1:30')
    expect(formatClock(3_600)).toBe('60:00')
    expect(formatClock(-4)).toBe('0:00')
  })

  it('formats inference time and local dates', () => {
    expect(formatInference(3.54)).toBe('3.5 秒')
    expect(formatInference(-1)).toBe('0.0 秒')
    expect(formatDate(new Date(2026, 9, 9))).toBe('2026-10-09')
    expect(formatDate(new Date(2026, 0, 1))).toBe('2026-01-01')
  })

  it('renders source, measurements, provider, and full text', () => {
    const content = renderTranscript({
      sourceName: '访谈.m4a',
      transcript: { text: '大家好。\n今天开个短会。', audioSeconds: 90, inferenceSeconds: 3.5 },
      providerId: 'sensevoice-local',
      providerName: 'SenseVoiceSmall (INT8)',
      generatedAt: new Date(2026, 9, 9),
    })
    expect(content).toBe([
      '# 访谈.m4a 录音转写',
      '',
      '- 时长：1:30',
      '- 转写用时：3.5 秒',
      '- 识别服务：sensevoice-local（SenseVoiceSmall (INT8)）',
      '- 生成日期：2026-10-09',
      '',
      '## 全文',
      '',
      '大家好。\n今天开个短会。',
      '',
    ].join('\n'))
  })

  it('marks a whitespace-only recognition as 未识别到语音', () => {
    const content = renderTranscript({
      sourceName: '空.wav',
      transcript: { text: '   \n ', audioSeconds: 1, inferenceSeconds: 0.1 },
      providerId: 'stub',
      providerName: 'Stub',
      generatedAt: new Date(2026, 9, 9),
    })
    expect(content).toContain('未识别到语音。')
  })
})
