/** Root-run assembled browser qualification for the local-only Changes composition. */
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspaceZh } from './support.ts'
const execute = promisify(execFile)
let scaffold: WebScaffold
let browser: Browser
let page: Page
async function git(...args: string[]): Promise<void> {
  await execute('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], {
    cwd: scaffold.workspaceCwd,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '', GIT_CONFIG_PARAMETERS: '', GIT_CONFIG_COUNT: '0' },
  })
}
describe('local worktree review browser', () => {
  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('../../../packages/experimental/worktree-review/cordis.patch.yml', import.meta.url)),
      extraInstallAnchors: [fileURLToPath(new URL('../../../packages/experimental/worktree-review/package.json', import.meta.url))],
    })
    await git('init', '-b', 'main')
    await git('config', 'user.name', 'Local review fixture')
    await git('config', 'user.email', 'review@example.invalid')
    await writeFile(join(scaffold.workspaceCwd, '.gitignore'), '/.dsh-home/\n/.agents-home/\n/.bundled-skills/\n')
    await writeFile(join(scaffold.workspaceCwd, 'tracked.txt'), 'before\n')
    await git('add', 'tracked.txt'); await git('commit', '-m', 'fixture')
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage({ locale: 'zh-CN' })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd, '.')
  }, 120_000)
  afterAll(async () => { await browser?.close(); await scaffold?.close() })
  it('shows exactly one Chinese tab, reads real local changes, and cancels an unstarted checkout request', async () => {
    await page.getByRole('button', { name: '打开右侧边栏', exact: true }).click()
    await page.locator('[data-sidebar-right-guide-entry="worktree-review"]').click()
    const panel = page.locator('[data-worktree-review]')
    await panel.waitFor()
    expect(await panel.count()).toBe(1)
    await panel.getByRole('button', { name: '使用独立工作目录', exact: true }).click()
    await panel.getByRole('button', { name: '取消创建', exact: true }).click()
    await panel.getByRole('button', { name: '使用独立工作目录', exact: true }).waitFor()
    const agent = scaffold.ctx.agents.list()[0]
    if (agent === undefined) throw new Error('fixture session is missing')
    expect(agent.session.header.cwd).toBe(scaffold.workspaceCwd)
    expect(scaffold.ctx.workingDirectory.get(agent.session)).toBe(scaffold.workspaceCwd)
    await writeFile(join(scaffold.workspaceCwd, 'tracked.txt'), 'after\n')
    const actualDiff = await scaffold.ctx.forgePanel.localDiff(agent.session, { kind: 'uncommitted' }, new AbortController().signal)
    expect(actualDiff.files.some(file => file.path === 'tracked.txt')).toBe(true)
    await panel.getByRole('button', { name: '刷新差异', exact: true }).click()
    await panel.getByRole('button', { name: /tracked\.txt/ }).click()
    await panel.getByRole('article', { name: 'tracked.txt', exact: true }).getByText('+after', { exact: false }).waitFor()
    expect(await panel.getByRole('button', { name: /GitHub|合并|发布/ }).count()).toBe(0)
  })
})
