/** Selected visible text travels through the real composer and Host as ordinary Markdown. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { formatQuoteText } from '@deepseek-ai/dsh-client-ui-primitives'
import { launchWebScaffold, seedSession, selectedSessionFixture, watchConsole, webSnapshotMode } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const BORROWED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.jsonl', import.meta.url))
const REPLAY = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))

it.skipIf(webSnapshotMode() === 'record')('quotes a mouse selection, retains it on refusal, and logs ordinary Markdown on acceptance', async () => {
  const host = await launchWebScaffold({ replayFixture: REPLAY, compareReplaySession: false })
  const browser = await chromium.launch()
  try {
    const fixture = await readFile(await selectedSessionFixture(BORROWED), 'utf8')
    await seedSession(host, fixture, 'quote-browser')
    const page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    const logged: string[] = []
    const off = host.ctx.on('session/event', (_session, event) => {
      if (event.type === 'user/message' && event.data.source.kind === 'user') {
        for (const part of event.data.content) if (part.type === 'text') logged.push(part.text)
      }
    })
    try {
      await page.goto(host.authenticatedUrl)
      const group = page.getByRole('treeitem', { name: /Ungrouped/ })
      await group.waitFor()
      if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
      await page.locator('[data-row-key="session:quote-browser"]').click()
      const source = page.locator('[data-chat-flow-kind="assistant-step"] p').first()
      await source.scrollIntoViewIfNeeded()
      await source.click({ clickCount: 3 })
      const selected = await page.evaluate(() => window.getSelection()?.toString().trim() ?? '')
      expect(selected.length).toBeGreaterThan(0)
      await page.getByRole('button', { name: 'Quote text', exact: true }).click()
      const quote = page.locator('[data-composer-quote]')
      await quote.waitFor()
      expect(await quote.textContent()).toContain(selected)
      const input = page.locator('[data-composer-input]').first()
      await page.route('**/api/session/prompt', async (route) => {
        const envelope = route.request().postDataJSON() as { rpcId: string }
        await route.fulfill({ status: 200, contentType: 'application/json', json: {
          type: 'server-response', rpcId: envelope.rpcId, result: { ok: false,
            error: { code: 'session/agent-busy', message: 'Refused', details: { reason: 'fixture refusal' } } },
        } })
      }, { times: 1 })
      await page.getByRole('button', { name: 'Send message', exact: true }).click()
      await expect.poll(() => input.getAttribute('contenteditable')).toBe('true')
      expect(await quote.count()).toBe(1)
      expect(logged).toEqual([])
      await page.getByRole('button', { name: 'Send message', exact: true }).click()
      await expect.poll(() => logged.some(text => text.includes(formatQuoteText(selected)))).toBe(true)
      await expect.poll(() => quote.count()).toBe(0)
      await page.locator('[data-quote-preview]').filter({ hasText: selected }).last().waitFor()
      expect(tripwire.pageErrors).toEqual([])
    } finally { off() }
  } finally { await browser.close(); await host.close() }
})
