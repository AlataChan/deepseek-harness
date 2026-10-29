/** Built-artifact acceptance requires an explicitly collected closure; it never launches product source. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const execute = promisify(execFile)
const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const driver = fileURLToPath(new URL('./linux/qualify-installed-ingress.ts', import.meta.url))
const tsx = fileURLToPath(new URL('../../../../node_modules/tsx/dist/cli.mjs', import.meta.url))
const artifact = process.env.DSH_IM_INSTALLED_ARTIFACT

it.skipIf(!artifact || process.platform === 'win32').each(['feishu', 'dingtalk'])('runs installed %s ingress and tenant profiles with durable cold-restart recovery', async (channel) => {
  if (!artifact) throw new Error('DSH_IM_INSTALLED_ARTIFACT is required')
  const result = await execute(process.execPath, [tsx, '--tsconfig', 'tsconfig.base.json', driver, artifact, channel], {
    cwd: repo, timeout: 90000, maxBuffer: 1024 * 1024,
  })
  expect(result.stdout).toContain('PASS: installed runtime + tool-free ingress')
}, 110000)

it('refuses an unavailable installed artifact without falling back to checkout product code', async () => {
  await expect(execute(process.execPath, [tsx, '--tsconfig', 'tsconfig.base.json', driver,
    '/nonexistent/dsh-im-installed-qualification-artifact'], { cwd: repo, timeout: 10000 }))
    .rejects.toMatchObject({ code: 1, stdout: '' })
})
