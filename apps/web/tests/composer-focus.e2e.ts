/** Real browser focus, refusal, and virtual viewport behavior through shipped composition. */
import { fileURLToPath } from 'node:url'
import { chromium, webkit, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))

async function exerciseKeyboardViewport(page: Page): Promise<string> {
  const input = page.locator('[data-composer-input][contenteditable="true"]')
  const restore = await page.evaluateHandle(() => {
    const viewport = window.visualViewport
    if (viewport === null) throw new Error('Expected a visual viewport')
    const style = document.documentElement.style
    const height = style.getPropertyValue('height')
    const priority = style.getPropertyPriority('height')
    const scroll = window.scrollY
    const offset = Object.getOwnPropertyDescriptor(viewport, 'offsetTop')
    style.setProperty('height', `${window.innerHeight * 2}px`)
    const input = document.querySelector<HTMLElement>('[data-composer-input]')!
    window.scrollTo(0, input.getBoundingClientRect().top + scroll - window.innerHeight / 4)
    // Safari can report the keyboard's page displacement as offsetTop even
    // though DOM rectangles already account for that page scroll.
    Object.defineProperty(viewport, 'offsetTop', { configurable: true, get: () => window.scrollY })
    window.dispatchEvent(new Event('scroll'))
    return () => {
      if (offset === undefined) Reflect.deleteProperty(viewport, 'offsetTop')
      else Object.defineProperty(viewport, 'offsetTop', offset)
      if (height === '') style.removeProperty('height')
      else style.setProperty('height', height, priority)
      window.scrollTo(0, scroll)
      window.dispatchEvent(new Event('scroll'))
    }
  })
  try {
    const before = await input.evaluate(el => ({ top: el.getBoundingClientRect().top, scroll: window.scrollY }))
    expect(before.scroll).toBeGreaterThan(0)
    expect(before.top).toBeGreaterThanOrEqual(0)
    await page.keyboard.insertText('z')
    const after = await input.evaluate(el => new Promise<{ top: number; scroll: number }>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        resolve({ top: el.getBoundingClientRect().top, scroll: window.scrollY })
      }))
    }))
    expect(after).toEqual(before)
    return '- typing with a keyboard-panned viewport preserves page scroll and composer position'
  } finally {
    await restore.evaluate((dispose) => { dispose() })
    await restore.dispose()
  }
}

for (const { engine, mobile } of [
  { engine: chromium, mobile: false }, { engine: chromium, mobile: true }, { engine: webkit, mobile: true },
]) {
  it.skipIf(webSnapshotMode() === 'record')(`${engine.name()} ${mobile ? 'mobile' : 'desktop'} preserves refused input and dismisses only accepted drafts`, async () => {
    const host = await launchWebScaffold({ replayFixture: FIXTURE, compareReplaySession: false })
    const browser = await engine.launch()
    let primaryFailure: unknown
    try {
      const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1280, height: 844 },
        locale: 'en-US', timezoneId: 'Asia/Shanghai',
        ...mobile ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1',
          isMobile: true, hasTouch: true } : {},
      })
      const tripwire = watchConsole(page)
      await page.goto(host.authenticatedUrl)
      const workspaceTrigger = await page.getByRole('textbox', { name: 'Choose workspace' }).elementHandle()
      if (workspaceTrigger === null) throw new Error('Workspace trigger is absent')
      expect(await workspaceTrigger.getAttribute('contenteditable')).toBe('false')
      await connectFreshWorkspace(page, host.workspaceCwd)
      const input = page.locator('[data-composer-input]').first()
      expect(await input.evaluate((element, trigger) => element === trigger, workspaceTrigger)).toBe(true)
      expect(await input.getAttribute('contenteditable')).toBe('true')
      if (mobile) expect(await input.evaluate(element => document.activeElement === element)).toBe(false)
      else await expect.poll(() => input.evaluate(element => document.activeElement === element)).toBe(true)
      await workspaceTrigger.dispose()
      const text = 'Reply with a one-sentence description of event sourcing, then stop.'
      await input.fill(text)
      await page.route('**/api/session/prompt', async (route) => {
        const envelope = route.request().postDataJSON() as { rpcId: string }
        await route.fulfill({ status: 200, contentType: 'application/json', json: {
          type: 'server-response', rpcId: envelope.rpcId, result: { ok: false,
            error: { code: 'session/agent-busy', message: 'Admission refused', details: { reason: 'fixture' } } },
        } })
      }, { times: 1 })
      const send = page.getByRole('button', { name: 'Send message', exact: true })
      if (mobile) await send.tap()
      else await send.click()
      await expect.poll(() => input.getAttribute('contenteditable')).toBe('true')
      expect(await input.textContent()).toBe(text)
      expect(await input.evaluate(element => document.activeElement === element)).toBe(true)
      expect(await page.locator('[data-submission-echo]').count()).toBe(0)
      if (mobile) {
        await exerciseKeyboardViewport(page)
        await input.fill(text)
        // The command menu remains constrained when the visual viewport is panned and shrunk.
        const restoreViewport = await page.evaluateHandle(() => {
          const viewport = window.visualViewport
          if (viewport === null) throw new Error('missing viewport')
          const offset = Object.getOwnPropertyDescriptor(viewport, 'offsetTop')
          const height = Object.getOwnPropertyDescriptor(viewport, 'height')
          Object.defineProperties(viewport, {
            offsetTop: { configurable: true, value: 140 }, height: { configurable: true, value: 360 },
          })
          viewport.dispatchEvent(new Event('resize'))
          return () => {
            if (offset === undefined) Reflect.deleteProperty(viewport, 'offsetTop')
            else Object.defineProperty(viewport, 'offsetTop', offset)
            if (height === undefined) Reflect.deleteProperty(viewport, 'height')
            else Object.defineProperty(viewport, 'height', height)
            viewport.dispatchEvent(new Event('resize'))
            viewport.dispatchEvent(new Event('scroll'))
          }
        })
        try {
          await page.getByRole('button', { name: 'Add files or run commands', exact: true }).tap()
          await page.getByRole('listbox', { name: 'Trigger suggestions', exact: true }).waitFor()
          const menu = page.locator('[data-trigger-menu]')
          const bounds = await menu.boundingBox()
          expect(bounds).not.toBeNull()
          if (bounds === null) throw new Error('menu has no geometry')
          expect(bounds.y).toBeGreaterThanOrEqual(140)
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(500)
          await page.keyboard.press('Escape')
        } finally {
          await restoreViewport.evaluate((dispose) => { dispose() })
          await restoreViewport.dispose()
        }
      }
      const settled = host.whenTurnSettled()
      if (mobile) await send.tap()
      else await send.click()
      await expect.poll(() => input.textContent()).toBe('')
      await expect.poll(() => input.evaluate(element => document.activeElement === element)).toBe(!mobile)
      if (mobile) expect(await page.locator('[data-composer-card]').evaluate(element => document.activeElement === element)).toBe(true)
      await settled
      expect(tripwire.pageErrors).toEqual([])
    } catch (error) {
      primaryFailure = error
      throw error
    } finally {
      await browser.close()
      try { await host.close() }
      catch (error) {
        if (primaryFailure === undefined) throw error
        throw new AggregateError([primaryFailure, error], 'Browser assertion and scaffold cleanup failed')
      }
    }
  })
}
