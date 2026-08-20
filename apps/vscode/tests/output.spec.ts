/** Redacted and bounded extension process output. */

import { describe, expect, it, vi } from 'vitest'
import { redactRuntimeLog, RuntimeOutput } from '../src/output.ts'

describe('VS Code runtime output', () => {
  it('redacts credential-shaped values and bounds emitted lines', () => {
    expect(redactRuntimeLog(
      'DEEPSEEK_API_KEY=secret sk-abcdefgh Bearer abc.def\r\0',
    )).toBe('DEEPSEEK_API_KEY=[REDACTED] [REDACTED] Bearer [REDACTED]')
    expect(redactRuntimeLog('x'.repeat(10_000))).toHaveLength(8_193)
  })

  it('exposes only redacted process and lifecycle logging', () => {
    const channel = { appendLine: vi.fn(), show: vi.fn(), dispose: vi.fn() }
    const output = new RuntimeOutput(channel)
    output.appendProcessChunk('stderr', 'TOKEN=secret\n')
    output.appendDiagnostic('Bearer value')
    output.show()
    output.dispose()
    expect(channel.appendLine).toHaveBeenNthCalledWith(1, '[stderr] TOKEN=[REDACTED]')
    expect(channel.appendLine).toHaveBeenNthCalledWith(2, '[extension] Bearer [REDACTED]')
    expect(channel.show).toHaveBeenCalledWith(true)
    expect(channel.dispose).toHaveBeenCalledOnce()
  })
})
