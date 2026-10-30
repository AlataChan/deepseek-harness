#!/usr/bin/env node
/** Verify IM settings discovery and configuration against an explicit installed runtime, without platform calls. */
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { InstalledCompanionRunner, validateInstalledTarget } from './verify-dsh-context-installed-flows.mjs'

/**
 * Exercise installed public settings RPCs and cold-start persistence with synthetic credentials only.
 * @param target - Packaged app or installed resources directory.
 * @returns Completion after all owned companion processes stop and temporary state is removed.
 */
export async function verifyInstalledImSettings(target) {
  const bundle = validateInstalledTarget(target)
  const name = '@deepseek-ai/dsh-experimental-desktop-im'
  const source = join(bundle.pluginRoot, name)
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  assert.equal(manifest.name, name)
  assert(manifest.dsh?.client && manifest.exports?.['./client'], 'IM settings must have an installed Client')
  const inventory = JSON.parse(readFileSync(join(bundle.pluginRoot, 'plugins.json'), 'utf8'))
  assert.equal(inventory.plugins[name].defaultEnabled, true, 'IM settings entry must be discoverable without enabling a channel')
  const client = readFileSync(join(source, 'lib', 'client.js'), 'utf8')
  assert(client.includes('settings.section') && client.includes('IM 接入'), 'Installed Client must contribute the IM settings entry')
  const root = mkdtempSync(join(tmpdir(), 'desktop-im-installed-'))
  const home = join(root, 'home'); const workspace = join(root, 'workspace')
  mkdirSync(home); mkdirSync(workspace)
  let runner
  const call = async (method, args = {}) => {
    const result = await runner.call(`desktopIm/${method}`, args)
    assert.equal(result.ok, true, `Installed IM RPC failed: ${JSON.stringify(result.error)}`)
    return result.value
  }
  try {
    runner = new InstalledCompanionRunner(bundle, home, workspace)
    runner.seedProfile()
    const profile = join(home, '.dsh', 'profiles', 'desktop')
    const destination = join(profile, 'node_modules', name)
    mkdirSync(join(profile, 'node_modules', '@deepseek-ai'), { recursive: true })
    cpSync(source, destination, { recursive: true })
    const profilePath = join(profile, 'package.json')
    const savedProfile = JSON.parse(readFileSync(profilePath, 'utf8'))
    savedProfile.dependencies[name] = manifest.version
    savedProfile.dsh.profile.bundles.push(name)
    writeFileSync(profilePath, JSON.stringify(savedProfile) + '\n')
    await runner.start({ offline: process.platform === 'darwin' })
    const initial = await call('list')
    assert.deepEqual(initial.map(row => [row.channel, row.enabled, row.phase, row.secretConfigured]), [
      ['feishu', false, 'off', false], ['dingtalk', false, 'off', false],
    ])
    const providers = await runner.call('llm/listProviders', {})
    assert(providers.ok && providers.value.some(provider => provider.id === 'deepseek-official'), 'Installed desktop must provide its normal model route')
    for (const channel of ['feishu', 'dingtalk']) {
      const config = { appId: 'synthetic-app', tenantId: 'synthetic-org', chatId: 'synthetic-chat', senderId: 'synthetic-operator',
        cwd: workspace, provider: 'deepseek-official', model: 'deepseek-v4-flash' }
      const saved = await call('save', { channel, config, secret: `synthetic-${channel}-secret` })
      assert.equal(saved.enabled, false)
      assert.equal(saved.secretConfigured, true)
      assert(!JSON.stringify(saved).includes(`synthetic-${channel}-secret`), 'Settings response leaked a secret')
      const disk = readFileSync(join(profile, 'im', `${channel}.json`), 'utf8')
      assert(!disk.includes(`synthetic-${channel}-secret`), 'Connection JSON leaked a secret')
      await call('setEnabled', { channel, enabled: false })
    }
    const refused = await runner.call('desktopIm/setEnabled', { channel: 'unconfigured-platform', enabled: true })
    assert.equal(refused.ok, false, 'Invalid-channel control must fail')
    assert(!existsSync(join(profile, 'im', 'feishu')), 'Saving must not create a channel runtime')
    await runner.stop()
    runner = new InstalledCompanionRunner(bundle, home, workspace)
    await runner.start({ offline: process.platform === 'darwin' })
    const restarted = await call('list')
    assert(restarted.every(row => row.enabled === false && row.secretConfigured === true && row.config?.appId === 'synthetic-app'))
    console.log('READY: installed IM settings discovery, redaction, saved OFF state, invalid-channel refusal and cold restart passed')
  } finally {
    await runner?.stop()
    rmSync(root, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyInstalledImSettings(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1 })
}
