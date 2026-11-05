// Keyless browser contract for copying a Session's complete history as Markdown.
// The seed is a local multi-page transcript: the open session shows the tail,
// and the copy route must still include the unloaded older turn. No model call.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const SESSION_ID = 'session-history-markdown-e2e'
const FIXTURE = createChatScrollFixture({
  markerPrefix: 'HISTORY_COPY',
  title: 'HISTORY_COPY long transcript',
  turns: 40,
})
const TRANSCRIPT_EXPECTED = fileURLToPath(new URL('./expected/session-history-markdown/transcript.expected.md', import.meta.url))
const MENU_EXPECTED = fileURLToPath(new URL('./expected/session-history-markdown/menu.expected.md', import.meta.url))
const REJECTED_EXPECTED = fileURLToPath(new URL('./expected/session-history-markdown/clipboard-rejected.expected.md', import.meta.url))

async function openSeed(page: Page): Promise<void> {
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  const search = page.getByRole('textbox', { name: 'Search session names', exact: true })
  await search.fill(FIXTURE.markers.user(1))
  const result = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  await expect.poll(() => result.count(), { timeout: 60_000 }).toBe(1)
  await result.click()
  await page.locator('[data-conversation-scroll]').getByText(FIXTURE.markers.assistant(FIXTURE.turns), { exact: false })
    .last()
    .waitFor({ timeout: 30_000 })
}

async function openHeaderMenu(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  const menu = page.getByRole('menu')
  await expect.poll(() => menu.evaluate(element => element.parentElement === document.body)).toBe(true)
  await menu.getByRole('menuitem', { name: 'Download session log' }).waitFor()
  return menu
}

async function copyFromMenu(page: Page): Promise<void> {
  const menu = await openHeaderMenu(page)
  await menu.getByRole('menuitem', { name: 'Copy Session as Markdown' }).click()
}

describe('web e2e: copy complete session history as Markdown', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, FIXTURE.log, SESSION_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    watchConsole(page)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(scaffold.authenticatedUrl).origin,
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('copies unloaded older history and keeps the ZIP menu', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-session-history-markdown'))
    await openSeed(page)
    const scroll = page.locator('[data-conversation-scroll]')
    expect(await scroll.getByText(FIXTURE.markers.user(1), { exact: false }).count()).toBe(0)
    expect(await scroll.getByText(FIXTURE.markers.assistant(FIXTURE.turns), { exact: false }).count()).toBeGreaterThan(0)

    const menu = await openHeaderMenu(page)
    const labels = (await menu.getByRole('menuitem').allInnerTexts()).map(label => label.trim()).join('\n')
    expect(`${labels}\n`).toBe(await readFile(MENU_EXPECTED, 'utf8'))
    await menu.getByRole('menuitem', { name: 'Copy Session as Markdown' }).click()
    await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()), { timeout: 30_000 })
      .toBe(await readFile(TRANSCRIPT_EXPECTED, 'utf8'))
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain(FIXTURE.markers.user(1))
    expect(copied).not.toContain('Synthetic chat-scroll system prompt')
    await page.getByRole('menuitem', { name: 'Download session log' }).waitFor({ state: 'hidden' })
  }, 60_000)

  it.skipIf(MODE === 'record')('reports a rejected clipboard write without dropping the transcript read', async () => {
    const rejected = await newEnglishPage(browser)
    onTestFailed(() => saveFailureShot(rejected, 'web-e2e-session-history-markdown-rejected'))
    watchConsole(rejected)
    await rejected.addInitScript(() => {
      const deny = (): Promise<void> => Promise.reject(new DOMException('denied', 'NotAllowedError'))
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: deny, write: deny },
      })
    })
    await rejected.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await rejected.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSeed(rejected)
    const markdown = rejected.waitForResponse(response => (
      response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/session.markdown'
    ), { timeout: 30_000 })
    await copyFromMenu(rejected)
    expect((await markdown).ok()).toBe(true)
    await rejected.getByRole('alert').filter({
      hasText: 'Could not write to the clipboard. Check clipboard permission and try again.',
    }).waitFor({ timeout: 10_000 })
    expect(`${await rejected.getByRole('alert').innerText()}\n`).toBe(await readFile(REJECTED_EXPECTED, 'utf8'))
    await rejected.close()
  }, 60_000)
})
