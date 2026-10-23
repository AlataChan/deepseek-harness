import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync, symlinkSync, readlinkSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { preparedMacOSApplication, refreshPreparedMacOSApplication } from './desktop-macos-preparation.ts'
import { payloadDigest } from './desktop-release-manifest.ts'

it.skipIf(process.platform === 'win32')('refreshes filesystem identities without changing signed payload bytes, modes or relative aliases', () => {
  const root = mkdtempSync(join(tmpdir(), 'macos-fresh-payload-'))
  const app = join(root, 'App.app')
  try {
    mkdirSync(app)
    const native = join(app, 'native')
    writeFileSync(native, 'signed executable bytes', { mode: 0o755 })
    symlinkSync('native', join(app, 'alias'))
    const before = statSync(native)
    const digest = payloadDigest(app)
    refreshPreparedMacOSApplication(app)
    expect(payloadDigest(app)).toBe(digest)
    expect(statSync(native).ino).not.toBe(before.ino)
    expect(statSync(native).mode).toBe(before.mode)
    expect(readlinkSync(join(app, 'alias'))).toBe('native')
    expect(readdirSync(root)).toEqual(['App.app'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it.skipIf(process.platform === 'win32')('refuses escaping aliases before replacing the original app and removes temporary copies', () => {
  const root = mkdtempSync(join(tmpdir(), 'macos-fresh-invalid-'))
  const app = join(root, 'App.app')
  try {
    mkdirSync(app)
    writeFileSync(join(root, 'outside'), 'outside bytes')
    symlinkSync('../outside', join(app, 'alias'))
    const before = statSync(app).ino
    expect(() => { refreshPreparedMacOSApplication(app) }).toThrow(/leaves its root/)
    expect(statSync(app).ino).toBe(before)
    expect(readdirSync(root).sort()).toEqual(['App.app', 'outside'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

describe('unsigned application signing handoff', () => {
  it('refuses changed bytes and target or qualification substitutions', () => {
    const root = mkdtempSync(join(tmpdir(), 'macos-prepared-'))
    try {
      writeFileSync(join(root, 'native'), 'assembled bytes')
      preparedMacOSApplication('record', root, 'arm64', 'public')
      expect(() => { preparedMacOSApplication('verify', root, 'arm64', 'public') }).not.toThrow()
      const marker = `${root}.prepared.json`
      const saved = JSON.parse(readFileSync(marker, 'utf8'))
      for (const invalid of [{ ...saved, schemaVersion: 1 }, { ...saved, readiness: undefined }]) {
        writeFileSync(marker, JSON.stringify(invalid))
        expect(() => { preparedMacOSApplication('verify', root, 'arm64', 'public') }).toThrow('Prepared application changed')
      }
      writeFileSync(marker, JSON.stringify(saved))
      expect(() => { preparedMacOSApplication('verify', root, 'x64', 'public') }).toThrow(/Prepared application changed/)
      expect(() => { preparedMacOSApplication('verify', root, 'arm64', 'internal') }).toThrow(/Prepared application changed/)
      writeFileSync(join(root, 'native'), 'different bytes')
      expect(() => { preparedMacOSApplication('verify', root, 'arm64', 'public') }).toThrow(/Prepared application changed/)
    } finally { rmSync(root, { recursive: true, force: true }); rmSync(`${root}.prepared.json`, { force: true }) }
  })
})
