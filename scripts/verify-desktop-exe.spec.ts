import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guard the constants the Windows build scripts duplicate from the macOS
 * scripts. The linter ignores `.mjs` files, so this spec is the only
 * mechanical check that `build-exe.mjs` and `build-kb-sidecar.mjs` still agree
 * with `build-dmg.sh` and `build-kb-sidecar.sh`; the macOS scripts stay the
 * macOS entry and are never edited by the Windows path.
 */

const root = resolve(import.meta.dirname, '..')

/**
 * Read one maintained build script.
 * @param path - repository-relative path.
 * @returns file contents.
 */
function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

/**
 * Extract a capture group from a build script, failing loud when the literal
 * moved instead of trivially returning undefined.
 * @param text - file contents.
 * @param pattern - pattern whose first group is the value.
 * @param label - the constant's name for the failure message.
 * @returns the captured value.
 */
function capture(text: string, pattern: RegExp, label: string): string {
  const match = pattern.exec(text)
  if (match?.[1] === undefined) throw new TypeError(`${label} not found`)
  return match[1]
}

/**
 * Every value captured by one pattern's first group.
 * @param text - file contents.
 * @param pattern - global pattern whose first group is the value.
 * @returns the captured values in match order.
 */
function capturedValues(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => {
    const value = match[1]
    if (value === undefined) throw new TypeError(`pattern ${String(pattern)} matched without its first group`)
    return value
  })
}

/**
 * Every value passed to one PyInstaller flag, sorted for comparison.
 * Matches both shell word form (`--collect-all pkg`) and argument-array form
 * (`'--collect-all', 'pkg'`).
 * @param text - file contents.
 * @param flag - the PyInstaller flag.
 * @returns the flag's values, sorted.
 */
function flagValues(text: string, flag: string): string[] {
  const pattern = new RegExp(`${flag}['",\\s]+([A-Za-z0-9_.-]+)`, 'g')
  return capturedValues(text, pattern).sort()
}

describe('Windows desktop build scripts', () => {
  it('keeps build-exe.mjs on the same NODE_VERSION as build-dmg.sh', () => {
    const dmg = capture(read('scripts/build-dmg.sh'), /NODE_VERSION="([^"]+)"/, 'build-dmg.sh NODE_VERSION')
    const exe = capture(read('scripts/build-exe.mjs'), /NODE_VERSION = '([^']+)'/, 'build-exe.mjs NODE_VERSION')
    expect(exe).toBe(dmg)
  })

  it('keeps the sidecar self-test key set in step with build-kb-sidecar.sh', () => {
    const shellKeys = capturedValues(read('scripts/build-kb-sidecar.sh'), /"([A-Za-z]+)": true/g).sort()
    const arrayLiteral = capture(
      read('scripts/build-kb-sidecar.mjs'),
      /const SELF_TEST_KEYS = \[([^\]]+)\]/,
      'build-kb-sidecar.mjs SELF_TEST_KEYS',
    )
    const moduleKeys = capturedValues(arrayLiteral, /'([^']+)'/g).sort()
    expect(moduleKeys).toEqual(shellKeys)
    expect(shellKeys).toEqual([
      'applyRules', 'convertFile', 'pageMetaFill', 'pdf', 'proposalSchema', 'retrieveFold', 'rulesSchema', 'xlsx',
    ])
  })

  it('keeps the PyInstaller collect-all and hidden-import sets identical', () => {
    const shell = read('scripts/build-kb-sidecar.sh')
    const module = read('scripts/build-kb-sidecar.mjs')
    expect(flagValues(module, '--collect-all')).toEqual(flagValues(shell, '--collect-all'))
    expect(flagValues(module, '--hidden-import')).toEqual(flagValues(shell, '--hidden-import'))
  })

  it('keeps the builtins.yaml add-data source in both freezes', () => {
    for (const path of ['scripts/build-kb-sidecar.mjs', 'scripts/build-kb-sidecar.sh']) {
      const text = read(path)
      expect(text).toContain('builtins.yaml')
      expect(text).toContain('octopus_kb_compound')
    }
  })
})

describe('desktop seed revision', () => {
  it('writes a stable 64-hex revision and changes it when one payload byte changes', () => {
    const resources = mkdtempSync(join(tmpdir(), 'dsh-seed-rev-'))
    try {
      const plugin = join(resources, 'profile-plugins', '@scope', 'plugin')
      const skill = join(resources, 'bundled-skills', 'wechat')
      mkdirSync(plugin, { recursive: true })
      mkdirSync(skill, { recursive: true })
      writeFileSync(join(plugin, 'package.json'), '{ "name": "@scope/plugin" }\n')
      writeFileSync(join(skill, 'SKILL.md'), '# first\n')
      const record = (): string => {
        const result = spawnSync(process.execPath, [resolve(root, 'scripts/write-seed-rev.mjs'), resources], { encoding: 'utf8' })
        expect(result.status, result.stderr).toBe(0)
        return readFileSync(join(resources, 'seed-rev.txt'), 'utf8')
      }
      const first = record()
      expect(first.trim()).toMatch(/^[0-9a-f]{64}$/)
      expect(record()).toBe(first)
      writeFileSync(join(skill, 'SKILL.md'), '# firsT\n')
      expect(record()).not.toBe(first)
    } finally {
      rmSync(resources, { recursive: true, force: true })
    }
  })

  it('records the revision in both build scripts', () => {
    for (const path of ['scripts/build-exe.mjs', 'scripts/build-dmg.sh']) {
      expect(read(path)).toContain('write-seed-rev.mjs')
    }
  })
})
