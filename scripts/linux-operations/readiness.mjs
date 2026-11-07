/** Hold the server runtime until its required MCP tool generation is registered. */
import { setTimeout as delay } from 'node:timers/promises'

export const name = 'octopus-ops-readiness'
export const inject = ['tools']

/** Publish readiness only after all finite operations tools are visible in the root registry. */
export async function apply(ctx, config) {
  for (const key of ['timeoutMs', 'pollIntervalMs']) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1 || config[key] > 120000) throw new Error(`Invalid readiness ${key}`)
  }
  const controller = new AbortController()
  ctx.effect(() => () => controller.abort(new Error('Readiness plugin disposed')))
  const deadline = Date.now() + config.timeoutMs
  const names = ['host_status', 'service_status', 'service_logs', 'wechat_status', 'wechat_screenshot', 'prepare', 'execute', 'receipt']
  while (!names.every(tool => ctx.tools.get(`mcp__server_ops__${tool}`))) {
    if (Date.now() >= deadline) throw new Error('Required operations MCP tools did not become ready')
    await delay(config.pollIntervalMs, undefined, { signal: controller.signal })
  }
  ctx.provide('octopusOpsReady', { ready: true })
}
