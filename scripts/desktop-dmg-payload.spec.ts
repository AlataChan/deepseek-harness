import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const script = resolve(import.meta.dirname, 'stage-desktop-dmg.mjs')
describe('DMG shipping payload by build mode', () => {
  it('ships the internal helper only internally and public instructions contain no bypass', () => {
    const root = mkdtempSync(join(tmpdir(), 'dmg-mode-'))
    try {
      const app = join(root, 'source.app'); mkdirSync(app)
      writeFileSync(join(app, 'binary'), 'tested app bytes')
      for (const mode of ['internal', 'public']) {
        const out = join(root, mode)
        const result = spawnSync(process.execPath, [script, mode, app, out], { encoding: 'utf8', timeout: 10_000 })
        expect(result.status, result.stderr).toBe(0)
        expect(readdirSync(out).sort()).toEqual(mode === 'public'
          ? ['octopus_DSH.app', '安装说明.txt'] : ['octopus_DSH.app', '安装并打开.command', '安装说明.txt'])
        expect(readFileSync(join(out, 'octopus_DSH.app', 'binary'), 'utf8')).toBe('tested app bytes')
        const instructions = readFileSync(join(out, '安装说明.txt'), 'utf8')
        if (mode === 'public') expect(instructions).not.toMatch(/xattr|quarantine|已损坏|未.*公证|安装并打开\.command/i)
        else expect(instructions).toContain('xattr -cr')
      }
      const stale = join(root, 'stale'); mkdirSync(stale)
      writeFileSync(join(stale, '安装并打开.command'), 'old helper')
      expect(spawnSync(process.execPath, [script, 'public', app, stale]).status).not.toBe(0)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})

it.skipIf(process.platform === 'win32')('assembles both modes through the actual DMG shell section under nounset', () => {
  const root = mkdtempSync(join(tmpdir(), 'dmg-shell-mode-'))
  const repo = resolve(import.meta.dirname, '..')
  try {
    symlinkSync(join(repo, 'scripts'), join(root, 'scripts'), 'dir')
    const app = join(root, 'input.app'); mkdirSync(app)
    writeFileSync(join(app, 'binary'), 'payload')
    const bin = join(root, 'bin'); mkdirSync(bin)
    writeFileSync(join(bin, 'create-dmg'), '#!/bin/bash\nprintf "%s\\n" "$@" > "$CONTROL_ARGS"\nprevious=; last=; for arg do previous=$last; last=$arg; done; touch "$previous"\n', { mode: 0o755 })
    const source = readFileSync(join(repo, 'scripts/build-dmg.sh'), 'utf8')
    const start = source.indexOf('info "Creating DMG..."')
    const end = source.indexOf('\necho ""', start)
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start)
    for (const mode of ['internal', 'public']) {
      const args = join(root, `${mode}.args`)
      const result = spawnSync('/bin/bash', ['-eu', '-c', `info(){ :; }; ok(){ :; }; fail(){ exit 1; }; ${source.slice(start, end)}`], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, REPO_ROOT: root, APP_BUNDLE: app, APP_NAME: 'octopus_DSH',
          BUILD_MODE: mode, DMG_OUTPUT: join(root, `${mode}.dmg`), CONTROL_ARGS: args }, encoding: 'utf8', timeout: 10_000,
      })
      expect(result.status, result.stderr).toBe(0)
      const actualArgs = readFileSync(args, 'utf8')
      expect(actualArgs.includes('安装并打开.command')).toBe(mode === 'internal')
      expect(readdirSync(join(root, 'dist/.cache/dmg-root')).includes('安装并打开.command')).toBe(mode === 'internal')
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 25_000)
