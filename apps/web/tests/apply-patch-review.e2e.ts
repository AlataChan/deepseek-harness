/**
 * Built-client review of the authored apply_patch Session.
 * Prerequisite: the integrated client build, then the refreshed fixture
 * snapshots/session/apply-patch-guarded/session.v4.jsonl.
 * Command: DSH_SNAPSHOT=replay PNPM_CONFIG_ENABLE_GLOBAL_VIRTUAL_STORE=false
 * pnpm --config.verify-deps-before-run=error exec vitest run --config vitest.web.config.ts
 * apps/web/tests/apply-patch-review.e2e.ts
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { expandOwningTurnProcess, newEnglishPage, saveFailureShot } from './support.ts'

const ROOT = fileURLToPath(new URL('../../../snapshots', import.meta.url))
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: apply-patch review', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(
      scaffold,
      await readFile(`${ROOT}/session/apply-patch-guarded/session.v4.jsonl`, 'utf8'),
      'apply-patch-guarded',
    )
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  })

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      await scaffold?.close()
    }
  })

  it('shows the committed diffs and the stopped partial line from the Session', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-apply-patch-review'))
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const ungrouped = page.getByRole('treeitem', { name: /Ungrouped/ })
    await ungrouped.waitFor({ timeout: 15_000 })
    if (await ungrouped.getAttribute('aria-expanded') !== 'true') await ungrouped.click()
    const sessionRow = page.getByRole('treeitem', { name: /Untitled/ })
    await sessionRow.waitFor({ timeout: 15_000 })
    await sessionRow.click()
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(1)
    const rows = page.locator('[data-tool="apply_patch"]')
    await expandOwningTurnProcess(page, rows.first())
    await rows.first().waitFor({ timeout: 10_000 })
    expect(await rows.count()).toBeGreaterThanOrEqual(4)
    const stopped = rows.filter({ hasText: 'Patch stopped after' })
    expect(await stopped.count()).toBe(1)
    expect(await stopped.textContent()).not.toContain('Success.')
    await stopped.locator('[data-expandable]').click()
    expect(await stopped.textContent()).toContain('kept')
    const committed = page.locator('[data-tool="apply_patch"][data-state="ok"]').filter({ hasNotText: 'Patch stopped after' })
    expect(await committed.count()).toBe(1)
    await committed.locator('[data-expandable]').click()
    const card = committed.locator('[data-diff]')
    await card.waitFor()
    expect(await card.textContent()).toContain('created')
    expect(await card.textContent()).toContain('hi')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
