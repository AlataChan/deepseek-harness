/** Pointer coverage for view/panel More menus and nested-call folding in the real Web client. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, seedSession, selectedSessionFixture, watchConsole, webSnapshotMode } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const PTC = fileURLToPath(new URL('../../../snapshots/session/ptc-turn/session.jsonl', import.meta.url))

it.skipIf(webSnapshotMode() === 'record')('keeps hidden views and panel entries reachable and folds only nested calls', async () => {
  const host = await launchWebScaffold({})
  const browser = await chromium.launch()
  try {
    await seedSession(host, await readFile(await selectedSessionFixture(PTC), 'utf8'), 'menus-and-subcalls')
    const page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(host.authenticatedUrl)
    const group = page.getByRole('treeitem', { name: /Ungrouped/ })
    await group.waitFor()
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
    await page.locator('[data-row-key="session:menus-and-subcalls"]').click()
    await page.setViewportSize({ width: 320, height: 640 })
    const moreViews = page.getByRole('button', { name: 'More conversation views', exact: true })
    await moreViews.click()
    const trajectory = page.getByRole('menuitem', { name: 'Trajectory', exact: true })
    await trajectory.waitFor()
    await page.getByRole('button', { name: 'Unpin Trajectory', exact: true }).click()
    await page.keyboard.press('Escape')
    expect(await page.getByRole('tab', { name: 'Trajectory', exact: true }).count()).toBe(0)
    await moreViews.click()
    await trajectory.click()
    const nested = page.locator('tr[data-kind="subtool"]:not([data-collapsed-summary])')
    await expect.poll(() => nested.count()).toBeGreaterThan(0)
    const parents = await page.locator('tr[data-kind="tool"]:not([data-collapsed-summary])').count()
    await page.getByRole('button', { name: 'Collapse subcalls', exact: true }).click()
    expect(await nested.count()).toBe(0)
    expect(await page.locator('tr[data-kind="tool"]:not([data-collapsed-summary])').count()).toBe(parents)
    await page.getByRole('button', { name: 'Expand subcalls', exact: true }).click()
    await expect.poll(() => nested.count()).toBeGreaterThan(0)
    await page.setViewportSize({ width: 1280, height: 420 })
    const panelMore = page.getByRole('button', { name: 'More panels', exact: true })
    await panelMore.click()
    const panelMenu = page.getByRole('menu').last()
    const rows = panelMenu.getByRole('menuitem')
    expect(await rows.count()).toBeGreaterThan(0)
    const label = await rows.first().textContent()
    await rows.first().click()
    expect(await panelMore.getAttribute('aria-expanded')).toBe('false')
    await panelMore.click()
    expect(await panelMenu.getByRole('menuitem').first().textContent()).toBe(label)
    await page.keyboard.press('Escape')
    expect(await page.getByRole('menu').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  } finally { await browser.close(); await host.close() }
})
