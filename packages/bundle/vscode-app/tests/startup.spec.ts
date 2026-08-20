/**
 * VS Code startup argument ownership: one absolute workspace root releases
 * dependent rows; help and malformed invocations leave them pending.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply,
  parseVsCodeStartupArgs,
  VSCODE_STARTUP_SERVICE,
  type VsCodeStartupValues,
} from '../src/startup.ts'

/** What one fixture boot observed. */
interface Observed {
  exits: number[]
  out: string
  readerConfig?: unknown
}

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

/** Mount the real provider and one injection-ordered config reader. */
async function bootProvider(args: string[]): Promise<{
  values: VsCodeStartupValues | undefined
  observed: Observed
}> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-vscode-startup-'))
  const observed: Observed = { exits: [], out: '' }
  writeFileSync(join(dir, 'reader.mjs'), `
export function apply(_ctx, config) { globalThis.__vscodeStartupObserved.readerConfig = config }
`)
  writeFileSync(join(dir, 'provider.mjs'), `
export const name = 'vscode-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__vscodeStartupApply(ctx)
`)
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: reader',
    `  name: ${pathToFileURL(join(dir, 'reader.mjs')).href}`,
    `  inject: [${VSCODE_STARTUP_SERVICE}]`,
    '  config:',
    '    workspaceRoot: !!js ctx.vscodeStartup.workspaceRoot',
    '- id: provider',
    `  name: ${pathToFileURL(join(dir, 'provider.mjs')).href}`,
    '',
  ].join('\n'))
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  internals.stdout = observing
  internals.stderr = observing
  const globals = globalThis as unknown as {
    __vscodeStartupApply: typeof apply
    __vscodeStartupObserved: Observed
  }
  globals.__vscodeStartupApply = apply
  globals.__vscodeStartupObserved = observed

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return {
    values: ctx.get(VSCODE_STARTUP_SERVICE) as VsCodeStartupValues | undefined,
    observed,
  }
}

describe('VS Code command-line provider', () => {
  it('publishes the selected absolute workspace root', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'dsh-vscode-workspace-'))
    const { values, observed } = await bootProvider(['--workspace-root', workspaceRoot])
    expect(values).toEqual({ workspaceRoot })
    expect(observed.readerConfig).toEqual(values)
    expect(observed.exits).toEqual([])
  })

  it('uses the same strict parser in the companion entry', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'dsh-vscode-companion-'))
    expect(parseVsCodeStartupArgs(['--workspace-root', workspaceRoot])).toEqual({ workspaceRoot })
    expect(isAbsolute(parseVsCodeStartupArgs(['--workspace-root', workspaceRoot]).workspaceRoot)).toBe(true)
    expect(() => parseVsCodeStartupArgs([])).toThrow('--workspace-root')
    expect(() => parseVsCodeStartupArgs(['--help'])).toThrow()
    expect(() => parseVsCodeStartupArgs(['--workspace-root', '.'])).toThrow('absolute')
    expect(() => parseVsCodeStartupArgs(['--workspace-root', workspaceRoot, '--port', '9'])).toThrow('unknown option')
  })

  it.each([
    { args: [], message: '--workspace-root' },
    { args: ['--workspace-root', '.'], message: 'absolute' },
    { args: ['--workspace-root', '/tmp', 'extra'], message: 'too many arguments' },
  ])('rejects $args before the consumer activates', async ({ args, message }) => {
    const { values, observed } = await bootProvider(args)
    expect(observed.out).toContain(message)
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })

  it('prints app-owned help and leaves the consumer pending', async () => {
    const { values, observed } = await bootProvider(['--help'])
    expect(observed.out).toContain('dsh --profile vscode')
    expect(observed.out).toContain('--workspace-root')
    expect(values).toBeUndefined()
    expect(observed.readerConfig).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })
})
