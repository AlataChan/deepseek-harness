/** Installed macOS bundles must declare microphone use before requesting capture. */
import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const mac = it.skipIf(process.platform !== 'darwin')
function fixture(): string {
  const app = mkdtempSync(join(tmpdir(), 'dsh-microphone-'))
  roots.push(app)
  mkdirSync(join(app, 'Contents'))
  writeFileSync(join(app, 'Contents/Info.plist'), '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>Fixture</string></dict></plist>\n')
  return app
}
function run(mode: string, app: string) {
  return spawnSync(process.execPath, ['scripts/desktop-microphone.mjs', mode, app], { encoding: 'utf8' })
}
mac('rejects a bundle without a microphone usage declaration', () => {
  const result = run('--check', fixture())
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('NSMicrophoneUsageDescription')
})
mac('adds microphone use idempotently and preserves unrelated bundle fields', () => {
  const app = fixture()
  expect(run('--apply', app).status).toBe(0)
  expect(run('--apply', app).status).toBe(0)
  expect(run('--check', app).status).toBe(0)
  const name = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleName', join(app, 'Contents/Info.plist')], { encoding: 'utf8' })
  expect(name.stdout.trim()).toBe('Fixture')
})
mac('rejects an empty microphone usage declaration', () => {
  const app = fixture()
  spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Add :NSMicrophoneUsageDescription string', join(app, 'Contents/Info.plist')])
  expect(run('--check', app).status).toBe(1)
})
mac('rejects a usage declaration with a non-string plist value', () => {
  const app = fixture()
  spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Add :NSMicrophoneUsageDescription dict', join(app, 'Contents/Info.plist')])
  expect(run('--check', app).status).toBe(1)
})
