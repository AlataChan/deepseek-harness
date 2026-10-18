/** Exercise the production phase branch without executing bundled code or using signing keys. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const script = readFileSync(new URL('./build-dmg.sh', import.meta.url), 'utf8')
const start = script.indexOf('info "Validating the $BUILD_MODE application before signing..."')
const end = script.indexOf('if [[ "$BUILD_MODE" == public ]]; then\n  node --import', start)

it.skipIf(process.platform === 'win32')('seals only after successful readiness and never runs readiness in the signing phase', () => {
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const root = mkdtempSync(join(tmpdir(), 'desktop-readiness-phase-'))
  try {
    const invalidate = script.match(/if \[\[ "\$PHASE" != sign \]\]; then\n# Failed preparation[^\n]*\n(rm -f[^\n]+)/)?.[1]
    expect(invalidate).toBe('rm -f "${APP_BUNDLE}.prepared.json"')
    const branch = `if [[ "$PHASE" != sign ]]; then\n${invalidate}\nfi\n` + script.slice(start, end).replaceAll('/usr/bin/codesign', 'codesign_probe')
    for (const [phase, failReadiness] of [['prepare', false], ['prepare', true], ['sign', true], ['complete', false]] as const) {
      const trace = join(root, 'trace')
      const seal = `${root}/App.prepared.json`
      writeFileSync(trace, '')
      writeFileSync(seal, 'previous preparation seal')
      const result = spawnSync('bash', ['-c', `
set -euo pipefail
info() { :; }
ok() { :; }
fail() { exit 1; }
codesign_probe() { printf 'adhoc\\n' >> "$TRACE"; }
node() {
  if [[ "$*" == *'preparation.ts record'* ]]; then printf 'seal\\n' >> "$TRACE"; : > "$SEAL";
  elif [[ "$*" == *'preparation.ts verify'* ]]; then printf 'verify\\n' >> "$TRACE"; fi
}
bash() { printf 'readiness\\n' >> "$TRACE"; [[ "$FAIL_READINESS" == false ]]; }
${branch}
`], { encoding: 'utf8', timeout: 5000, env: {
        PATH: process.env.PATH, HOME: root, REPO_ROOT: root, APP_BUNDLE: join(root, 'App'), RESOURCES: root,
        ARCH: 'arm64', BUILD_MODE: phase === 'complete' ? 'internal' : 'public', PHASE: phase, TRACE: trace, SEAL: seal, FAIL_READINESS: String(failReadiness),
      } })
      expect(result.error).toBeUndefined()
      const calls = readFileSync(trace, 'utf8').trim().split('\n')
      expect(result.status, result.stderr).toBe(failReadiness && phase === 'prepare' ? 1 : 0)
      expect(existsSync(seal)).toBe(phase === 'sign' || (phase === 'prepare' && !failReadiness))
      if (phase === 'sign') expect(calls).toEqual(['verify'])
      else expect(calls).toContain('readiness')
      if (phase === 'prepare' && !failReadiness) expect(calls.at(-1)).toBe('seal')
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it.skipIf(process.platform === 'win32')('refuses the unphased public build before assembly or credential access', () => {
  const result = spawnSync('bash', ['scripts/build-dmg.sh'], {
    encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH, DSH_DESKTOP_BUILD_MODE: 'public' },
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('Public builds require --prepare-only')
})
