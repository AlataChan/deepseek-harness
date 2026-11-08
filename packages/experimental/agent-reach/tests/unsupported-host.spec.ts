/** Classification refusals only: changing a host label does not qualify that operating system. */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentReachRunner } from '../src/runner.ts'
import { AgentReachSetupService } from '../src/setup.ts'
import { computeSetupPlan } from '../src/setup-plan.ts'
import { installationTarget } from '../src/installer.ts'

const actualPlatform = process.platform
let ctx: Context
let directory: string
beforeEach(() => {
  ctx = new Context()
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reach-host-refusal-'))
})
afterEach(async () => {
  Object.defineProperty(process, 'platform', { value: actualPlatform })
  await ctx.fiber.dispose()
  vi.unstubAllEnvs()
  fs.rmSync(directory, { recursive: true, force: true })
})
it.each(['linux', 'win32'])('refuses installation and execution for unqualified %s without mutation', async (platform) => {
  Object.defineProperty(process, 'platform', { value: platform })
  expect(installationTarget()).toBeUndefined()
  expect(computeSetupPlan('v2ex', 'hot', undefined, {}, directory)).toMatchObject({ ok: false, code: 'UNSUPPORTED' })
  expect(await new AgentReachSetupService(ctx, {}, directory).runSetup('v2ex', 'hot')).toMatchObject({ status: 'unsupported', error: { code: 'UNSUPPORTED' } })
  expect(await new AgentReachRunner(ctx, {}, { dshHome: directory }).spawnCli(['version'])).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED' } })
  expect(fs.readdirSync(directory)).toEqual([])
})
it.skipIf(actualPlatform !== 'darwin' || process.arch !== 'arm64')('rejects a route whose backend has no frozen installation recipe', async () => {
  const config = { enabledChannels: ['github'] }
  const planned = computeSetupPlan('github', 'search', 'gh', config, directory)
  expect(planned).toMatchObject({ ok: false, code: 'UNSUPPORTED' })
  expect(await new AgentReachSetupService(ctx, config, directory).runSetup('github', 'search', 'gh')).toMatchObject({ status: 'unsupported' })
  expect(fs.readdirSync(directory)).toEqual([])
})
it.skipIf(actualPlatform !== 'darwin' || process.arch !== 'arm64')('resolves the default owner directory from DSH_HOME without creating it', async () => {
  vi.stubEnv('DSH_HOME', directory)
  const result = await new AgentReachSetupService(ctx).runSetup('v2ex', 'hot', undefined, { planOnly: true })
  expect(result.status).toBe('planned')
  expect(result.plan?.releaseRoot.startsWith(directory)).toBe(true)
  expect(fs.readdirSync(directory)).toEqual([])
})
it.skipIf(actualPlatform !== 'darwin' || process.arch !== 'arm64')('uses the owner home fallback and computes a no-HOME plan without writing either path', async () => {
  vi.stubEnv('DSH_HOME', undefined)
  vi.stubEnv('HOME', directory)
  const result = await new AgentReachSetupService(ctx).runSetup('v2ex', 'hot', undefined, { planOnly: true })
  expect(result.plan?.releaseRoot.startsWith(path.join(directory, '.dsh'))).toBe(true)
  vi.stubEnv('HOME', undefined)
  const plan = computeSetupPlan('v2ex', 'hot', undefined, {})
  expect(plan.ok).toBe(true)
  if (!plan.ok) throw new Error(plan.error)
  expect(plan.plan.releaseRoot.startsWith(path.join('/tmp', '.dsh'))).toBe(true)
  expect(fs.readdirSync(directory)).toEqual([])
})
