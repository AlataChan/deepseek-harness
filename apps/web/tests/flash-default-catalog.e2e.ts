/** Shipped DeepSeek catalog names through the built browser, without inference requests. */
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold,
  watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspaceZh, saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

describe.skipIf(webSnapshotMode() === 'record')('web e2e: shipped Flash default catalog', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let modelCalls = 0

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
    scaffold.ctx.on('llm/stream', () => {
      modelCalls++
      throw new Error('Catalog-only acceptance must not issue inference requests')
    })
    await scaffold.ctx.credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'sk-inert-catalog-fixture')
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1000, height: 720 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    try { await browser?.close() } finally { await scaffold?.close() }
  })

  it('displays the canonical name while preserving the provider, model id and effort', async () => {
    onTestFailed(() => saveFailureShot(page, 'flash-default-catalog'))
    const selection = scaffold.ctx.agentDefaultModel.currentSelection()
    expect(selection).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash' })
    await expect(scaffold.ctx.llm.resolveModelInfo(selection.provider, selection.model)).resolves.toMatchObject({
      id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash',
    })
    const trigger = page.getByRole('button', { name: /^选择模型，当前 DeepSeek-V4\.1-Flash/ })
    await trigger.click()
    await page.getByRole('menuitem', { name: /^模型/ }).click()
    await page.getByRole('menuitemradio', { name: 'DeepSeek-V4.1-Flash', exact: true }).waitFor()
    await compareOrRefreshGolden(
      fileURLToPath(new URL('./expected/flash-default-catalog/picker.expected.md', import.meta.url)),
      await captureStableAria(page, '[role="group"][aria-label="模型与推理等级"]', scaffold.workspaceCwd),
      webSnapshotMode(),
    )
    await page.keyboard.press('Escape')
    await page.getByRole('menuitem', { name: /推理等级/ }).click()
    await page.getByRole('menuitemradio', { name: 'High', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    expect(scaffold.ctx.agentDefaultModel.currentSelection()).toEqual(selection)
    expect(modelCalls).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  })
})
