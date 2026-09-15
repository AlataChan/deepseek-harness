// Web e2e scenario: the approved ACP commerce recording, seeded cold through
// the persistence seam, renders through commerce-mode's keyed tool cards
// without a model call. The staged card shows the grounded before and after
// line, and the export card names the written file, the no-store-write notice,
// and the ledger counts the Host projection folds from the same log.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { expandOwningTurnProcess, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/acp/commerce-export-approved/session.jsonl', import.meta.url))
const INPUT = fileURLToPath(new URL('../../../snapshots/acp/commerce-export-approved/input.json', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/commerce-export-card', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('../../../snapshots/web/commerce-export-card/ui.expected.md', import.meta.url))
const OVERLAY = fileURLToPath(new URL('./commerce-export-card.overlay.yml', import.meta.url))
const INSTALL_ANCHORS = [
  fileURLToPath(new URL('./support/commerce-export-card/package.json', import.meta.url)),
]
const MODE = webSnapshotMode()
const SEED_ID = 'commerce-export-card-web-e2e'
const EXPORT_PATH = 'commerce-exports/b78cf93b2a6432b4.csv'

describe.skipIf(MODE === 'record')('web e2e: commerce staged-change and export cards', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    const fixture = await readFile(FIXTURE, 'utf8')
    const input = JSON.parse(await readFile(INPUT, 'utf8')) as { steps: { op: string; text?: string }[] }
    expect(fixtureUserPrompts(fixture)).toEqual(input.steps.flatMap(step => step.op === 'prompt' ? [step.text] : []))
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, extraInstallAnchors: INSTALL_ANCHORS })
    await seedSession(scaffold, fixture, SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    const exportCard = page.locator('[data-tool="commerce_export_changes"]')
    await expandOwningTurnProcess(page, exportCard)
    await exportCard.waitFor({ timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows the staged line and the approved export file with the ledger counts', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-commerce-export-card'))
    const staged = page.locator('[data-tool="commerce_stage_price_change"]')
    await staged.getByText('chg-0001 · Price change · Raise jasmine tea to 21.90', { exact: true }).waitFor()
    await staged.getByRole('button', { expanded: false }).click()
    const cells = staged.getByRole('cell')
    await expect.poll(() => cells.allTextContents()).toEqual(['P-100', 'price', '19.9', '21.9'])

    const exported = page.locator('[data-tool="commerce_export_changes"]')
    await exported.getByText(`1 exported · ${EXPORT_PATH}`, { exact: true }).waitFor()
    await exported.getByRole('button', { expanded: false }).click()
    await exported.getByText(EXPORT_PATH, { exact: true }).waitFor()
    expect(await exported.getByRole('button', { name: 'Open' }).count()).toBe(1)
    await exported.getByText('Nothing was sent to a store; the merchant uploads this file.', { exact: true }).waitFor()
    await exported.getByText('Current ledger: 0 staged · 1 exported · 0 discarded', { exact: true }).waitFor()

    const snapshot = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      .replace(/\b\d{1,2}\/\d{1,2}(?= \{\{clock\}\})/g, '{{date}}')
      .replace(/\{\{date\}\} (?=\{\{clock\}\} Ran for)/g, '')
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  })
})
