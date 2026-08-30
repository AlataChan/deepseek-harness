import { Context } from '@deepseek-ai/cordis'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { describe, expect, it } from 'vitest'
import { apply, parseDesktopStartupArgs } from '../src/startup.ts'

describe('parseDesktopStartupArgs', () => {
  it('accepts one absolute workspace root', () => {
    expect(parseDesktopStartupArgs(['--workspace-root', '/tmp/project']))
      .toEqual({ workspaceRoot: '/tmp/project' })
  })

  it('rejects a relative workspace root', () => {
    expect(() => parseDesktopStartupArgs(['--workspace-root', './project']))
      .toThrow(/absolute/u)
  })

  it('rejects a missing workspace root', () => {
    expect(() => parseDesktopStartupArgs([])).toThrow(/--workspace-root/u)
  })

  it('rejects an unknown argument', () => {
    expect(() => parseDesktopStartupArgs(['--workspace-root', '/tmp/p', '--port', '3080']))
      .toThrow(/--port/u)
  })

  it('throws on help after writing usage', () => {
    expect(() => parseDesktopStartupArgs(['--help'])).toThrow()
  })
})

describe('the desktop command-line provider', () => {
  it('publishes the selected absolute workspace root', () => {
    const ctx = new Context()
    provideCmdline(ctx, { args: ['--workspace-root', '/tmp/project'], exit: () => {} })
    apply(ctx)
    expect(ctx.desktopStartup).toEqual({ workspaceRoot: '/tmp/project' })
    expect(ctx.get('webStartup')).toEqual({
      openBrowser: false,
      host: '127.0.0.1',
      port: 0,
      trustedHosts: [],
    })
  })
})
