import { Context } from '@deepseek-ai/cordis'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { describe, expect, it, vi } from 'vitest'
import { apply, parseTuiStartupArgs } from '../src/startup.ts'

function parseError(args: string[]): { exitCode: number } {
  try {
    parseTuiStartupArgs(args)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'exitCode' in error
      && typeof error.exitCode === 'number') return { exitCode: error.exitCode }
    throw error
  }
  throw new Error(`expected ${JSON.stringify(args)} to fail`)
}

describe('tui startup arguments', () => {
  it('resolves fresh startup with an optional joined task', () => {
    expect(parseTuiStartupArgs([])).toEqual({ kind: 'fresh' })
    expect(parseTuiStartupArgs(['write', 'the', 'tests']))
      .toEqual({ kind: 'fresh', task: 'write the tests' })
  })

  it('resolves selector and exact-session resume', () => {
    expect(parseTuiStartupArgs(['--resume'])).toEqual({ kind: 'resume-picker' })
    expect(parseTuiStartupArgs(['--resume', 'session-id']))
      .toEqual({ kind: 'resume', sessionId: 'session-id' })
  })

  it('leaves help and usage failures to Commander', () => {
    expect(parseError(['--help']).exitCode).toBe(0)
    expect(parseError(['--unknown']).exitCode).toBe(1)
    expect(parseError(['--resume', 'session-id', 'task']).exitCode).toBe(1)
  })

  it('publishes parsed startup through the launcher command-line service', () => {
    const ctx = new Context()
    provideCmdline(ctx, { args: ['start', 'now'], exit: vi.fn() })
    apply(ctx)
    expect(ctx.get('tuiStartup')).toEqual({ kind: 'fresh', task: 'start now' })
  })
})
