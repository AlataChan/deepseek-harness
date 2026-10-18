import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { preparedMacOSApplication } from './desktop-macos-preparation.ts'

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
