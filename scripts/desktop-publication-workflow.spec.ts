/** Source controls for release credential scope and workflow source policy. */
import { existsSync, readFileSync } from 'node:fs'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface Step { name?: string; uses?: string; env?: Record<string, string>; run?: string; if?: string }
interface Job { if?: string; environment?: string; permissions?: Record<string, string>; env?: Record<string, string>; steps: Step[] }
interface Workflow { env?: Record<string, string>; jobs: Record<string, Job> }
function workflow(name: string): Workflow {
  return yaml.load(readFileSync(`.github/workflows/desktop-${name}.yml`, 'utf8')) as Workflow
}
describe('desktop publication credential policy', () => {
  it('pins every executed action and keeps the release write credential in the final protected step', () => {
    for (const name of ['publish', 'windows', 'macos']) {
      for (const job of Object.values(workflow(name).jobs)) {
        for (const step of job.steps) if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/)
      }
    }
    const publish = workflow('publish').jobs.publish!
    expect(publish.environment).toBe('desktop-public-release')
    expect(publish.if).toContain("github.repository == 'AlataChan/deepseek-harness'")
    expect(publish.if).toContain("github.ref == 'refs/heads/master'")
    expect(publish.if).toContain("github.ref == 'refs/heads/release'")
    expect(publish.permissions?.contents).toBe('read')
    expect(publish.env?.GH_TOKEN).toBe('${{ github.token }}')
    expect(publish.steps.filter(step => step.env?.GH_TOKEN?.includes('secrets.'))).toEqual([publish.steps.at(-1)])
    expect(publish.steps.at(-1)?.env?.GH_TOKEN).toBe('${{ secrets.DSH_DESKTOP_PUBLISH_TOKEN }}')
  })
  it('imports public signing credentials before preflight and cleans them on failure', () => {
    for (const name of ['windows', 'macos']) {
      const job = Object.values(workflow(name).jobs)[0]!
      expect(job.environment).toContain('desktop-signing')
      const imported = job.steps.findIndex(step => step.name?.startsWith('Import public'))
      const preflight = job.steps.findIndex(step => step.name === 'Check public signing prerequisites')
      expect(imported).toBeGreaterThanOrEqual(0)
      expect(preflight).toBeGreaterThan(imported)
      expect(job.steps[imported]?.if).toBe("inputs.build_mode == 'public'")
      const cleanup = job.steps.find(step => step.name?.startsWith('Remove public'))!
      expect(cleanup.name).toMatch(/^Remove public/)
      expect(cleanup.if).toBe("always() && inputs.build_mode == 'public'")
    }
  })
})

it('keeps the NSIS resources root free of an unshipped tracked placeholder', () => {
  expect(existsSync('apps/desktop/src-tauri/resources/.gitkeep')).toBe(false)
  const assembly = readFileSync('scripts/build-exe.mjs', 'utf8')
  expect(assembly).toContain('mkdirSync(RESOURCES, { recursive: true })')
})

it('finishes macOS assembly before importing a non-extractable codesign-only key', () => {
  const steps = workflow('macos').jobs['build-dmg']!.steps
  const imported = steps.findIndex(step => step.name === 'Import public Developer ID and notary credentials')
  const cleaned = steps.findIndex(step => step.name === 'Remove public macOS signing keychain')
  expect(imported).toBeGreaterThan(steps.findIndex(step => step.name === 'Build Tauri application'))
  expect(imported).toBeGreaterThan(steps.findIndex(step => step.run?.includes('--prepare-only')))
  const importScript = steps[imported]!.run!
  expect(importScript).toContain('-x -T /usr/bin/codesign')
  expect(importScript).not.toMatch(/(?:^|\s)-A(?:\s|$)/)
  expect(importScript).toContain('-S apple:,codesign:')
  expect(importScript).not.toContain('apple-tool:')
  expect(steps.slice(imported + 1, cleaned).some(step => /pnpm|npm|pip|dlx/.test(step.run ?? ''))).toBe(false)
  expect(steps.slice(imported + 1, cleaned).some(step => step.run?.includes('--sign-prepared'))).toBe(true)
  const script = readFileSync('scripts/build-dmg.sh', 'utf8')
  expect(script).toContain('ROOT_SIGN_ARGS=(--entitlements "$REPO_ROOT/scripts/desktop-app-entitlements.plist")')
  const app = readFileSync('scripts/desktop-app-entitlements.plist', 'utf8')
  expect(app.match(/<key>.*?<\/key>/g)).toEqual(['<key>com.apple.security.device.audio-input</key>'])
  const node = readFileSync('scripts/desktop-node-entitlements.plist', 'utf8')
  expect(node).toContain('com.apple.security.cs.allow-jit')
  expect(node).toContain('com.apple.security.cs.disable-library-validation')
})

it('compares the original approval JSON with the handoff before entering the writer', () => {
  const step = workflow('publish').jobs.publish!.steps.at(-1)!
  expect(step.env?.DSH_REVIEWED_PLAN).toBe('${{ inputs.reviewed_plan }}')
  expect(step.run!.indexOf('verify-desktop-reviewed-plan.ts handoff/publication-plan.json')).toBeLessThan(step.run!.indexOf('publish-qualified'))
  expect(step.run).toContain("if ($LASTEXITCODE -ne 0) { throw 'Original reviewed plan and qualification handoff differ' }")
})

it('checks public setting names and secret-presence booleans before expensive macOS builds', () => {
  const steps = workflow('macos').jobs['build-dmg']!.steps
  const config = steps.findIndex(step => step.name === 'Check public signing configuration before building')
  expect(config).toBeGreaterThanOrEqual(0)
  expect(config).toBeLessThan(steps.findIndex(step => step.name === 'Build workspace libraries and clients'))
  expect(config).toBeLessThan(steps.findIndex(step => step.run?.includes('--prepare-only')))
  expect(steps[config]!.run).toContain('config-preflight')
  expect(Object.values(steps[config]!.env!)).toHaveLength(5)
  for (const value of Object.values(steps[config]!.env!)) expect(value).toMatch(/^\$\{\{ secrets\.[A-Z0-9_]+ != '' \}\}$/)
  const script = readFileSync('scripts/build-dmg.sh', 'utf8')
  expect(script.indexOf('config-preflight')).toBeLessThan(script.indexOf('if [[ "$PHASE" != prepare ]]'))
})

it('preserves original approval bytes during read-only qualification', () => {
  const native = readFileSync('scripts/tests/desktop-publication-native.ps1', 'utf8')
  expect(native).toContain('[IO.File]::WriteAllText($plan, $env:DSH_REVIEWED_PLAN, [Text.UTF8Encoding]::new($false))')
  const cli = readFileSync('scripts/desktop-release-cli.ts', 'utf8')
  const branch = cli.slice(cli.indexOf("if (command === 'qualify-plan')"), cli.indexOf("} else if (command === 'verify')"))
  expect(branch).toContain('await qualifyReviewedPlan(plan, remote)')
  expect(branch).not.toMatch(/save\(|writeFile/)
})

it('runs bundled readiness only during preparation and after signing-key cleanup', () => {
  const steps = workflow('macos').jobs['build-dmg']!.steps
  const prepared = steps.findIndex(step => step.run?.includes('--prepare-only'))
  const imported = steps.findIndex(step => step.name === 'Import public Developer ID and notary credentials')
  const cleaned = steps.findIndex(step => step.name === 'Remove public macOS signing keychain')
  const mounted = steps.findIndex(step => step.name === 'Verify mounted desktop bundle')
  expect(prepared).toBeGreaterThan(-1)
  expect(imported).toBeGreaterThan(prepared)
  expect(cleaned).toBeGreaterThan(imported)
  expect(mounted).toBeGreaterThan(cleaned)
  const script = readFileSync('scripts/build-dmg.sh', 'utf8')
  expect(script.match(/bash "\$REPO_ROOT\/scripts\/verify-desktop-bundle\.sh"/g)).toHaveLength(1)
  expect(script.indexOf('verify-desktop-bundle.sh')).toBeLessThan(script.indexOf('desktop-macos-preparation.ts" record'))
})
