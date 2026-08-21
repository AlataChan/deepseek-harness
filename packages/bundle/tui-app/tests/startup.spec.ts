import { describe, expect, it } from 'vitest'
import { parseTuiStartupArgs } from '../src/startup.ts'

function parseError(args: string[]): { exitCode: number } {
  try {
    parseTuiStartupArgs(args)
  } catch (error) {
    expect(error).toMatchObject({ exitCode: expect.any(Number) })
    return error as { exitCode: number }
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
})
