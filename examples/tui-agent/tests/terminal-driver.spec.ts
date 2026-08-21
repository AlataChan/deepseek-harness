import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  encodeTerminalActions,
  normalizeTerminalOutput,
  resolveTuiTerminalLaunch,
  runTuiTerminal,
} from './fixtures/terminal-driver.ts'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const dshSource = fileURLToPath(new URL('../../../apps/cli/src/bin.ts', import.meta.url))
const dshBuilt = fileURLToPath(new URL('../../../apps/cli/lib/bin.js', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('TUI terminal driver', () => {
  it('resolves source and built launches with only the standard streams', () => {
    const source = resolveTuiTerminalLaunch({
      mode: 'src', dshSource, dshBuilt, tsconfigPath, patchPath: '/tmp/overlay.yml',
      cwd: '/tmp/workspace', dshHome: '/tmp/home',
    })
    expect(source.args).toEqual(expect.arrayContaining([
      '--import', expect.any(String), dshSource, '--profile', 'tui', '--patch', '/tmp/overlay.yml',
    ]))
    expect(source.env.TSX_TSCONFIG_PATH).toBe(tsconfigPath)
    expect(source.stdio).toEqual(['stdin', 'stdout', 'stderr'])

    const built = resolveTuiTerminalLaunch({
      mode: 'lib', dshSource, dshBuilt, tsconfigPath, patchPath: '/tmp/overlay.yml',
      cwd: '/tmp/workspace', dshHome: '/tmp/home',
    })
    expect(built.args).toEqual([dshBuilt, '--profile', 'tui', '--patch', '/tmp/overlay.yml'])
    expect(built.env.TSX_TSCONFIG_PATH).toBeUndefined()
  })

  it('keeps pasted text, semantic keys, and resize actions separate', () => {
    expect(encodeTerminalActions([
      { waitFor: 'ready', text: '/help' },
      { waitForFile: '.settled' },
      { key: 'return' },
      { resize: { columns: 48, rows: 20 } },
      { key: 'ctrl-c' },
    ])).toEqual([
      { waitFor: 'ready', bytes: '/help' },
      { waitForFile: '.settled' },
      { bytes: '\r' },
      { resize: [20, 48] },
      { bytes: '\u0003' },
    ])
  })

  it('removes renderer control sequences without deleting repeated visible rows', () => {
    expect(normalizeTerminalOutput('\u001b[?25lfirst\r\n\u001b[2K\u001b[1A\rfirst\r\nfirst\u001b[?25h'))
      .toBe('first\n\nfirst\nfirst\n')
  })

  it.skipIf(process.platform === 'win32')('sequences PTY input, resize, exit, and raw-mode restoration', async () => {
    const fixture = [
      'process.stdin.setRawMode(true)',
      'process.stdin.resume()',
      'process.stdout.write(`READY:${process.stdout.columns}\\n`)',
      "process.on('SIGWINCH', () => process.stdout.write(`SIZE:${process.stdout.columns}\\n`))",
      "process.stdin.on('data', chunk => {",
      "  const hex = Buffer.from(chunk).toString('hex')",
      '  process.stdout.write(`KEY:${hex}\\n`)',
      "  if (hex === '03') { process.stdin.setRawMode(false); process.exit(0) }",
      '})',
    ].join(';')
    const result = await runTuiTerminal({
      cwd: repoRoot,
      launch: { command: process.execPath, args: ['-e', fixture], env: {}, stdio: ['stdin', 'stdout', 'stderr'] },
      columns: 72,
      rows: 24,
      timeoutMs: 5_000,
      actions: [
        { waitFor: 'READY:72', text: 'ok' },
        { waitFor: 'KEY:6f6b', resize: { columns: 51, rows: 18 } },
        { waitFor: 'SIZE:51', key: 'ctrl-c' },
      ],
    })
    expect(result.output).toContain('KEY:6f6b')
    expect(result.output).toContain('SIZE:51')
    expect(result.output).toContain('KEY:03')
    expect(result.exitCode).toBe(0)
    expect(result.rawModeRestored).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('kills a PTY child when the action deadline expires', async () => {
    await expect(runTuiTerminal({
      cwd: repoRoot,
      launch: {
        command: process.execPath,
        args: ['-e', 'process.stdin.setRawMode(true); process.stdin.resume(); setInterval(() => {}, 1000)'],
        env: {},
        stdio: ['stdin', 'stdout', 'stderr'],
      },
      timeoutMs: 150,
      actions: [{ waitFor: 'never', key: 'ctrl-c' }],
    })).rejects.toThrow(/completed 0\/1 terminal actions before timeout/)
  })
})
