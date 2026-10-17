/** Recorded, keyless next-message acceptance through the assembled Host and resident editor. */
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-experimental-assistant-registry'
import { assertReplaySession, launchWebScaffold, recordFixture, webSnapshotMode, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot, writeComposerDraft } from './support.ts'

const scenario = fileURLToPath(new URL('../../../snapshots/web/composer-predictions', import.meta.url))
const provider = 'composer-recording'
const model = 'composer-model'

/** External provider double; recorded Session and auxiliary events supply replay responses. */
class PredictionAdapter extends LlmAdapter {
  readonly normalStarted = Promise.withResolvers<undefined>()
  readonly normalRelease = Promise.withResolvers<undefined>()
  readonly predictionStarted = Promise.withResolvers<undefined>()
  readonly predictionRelease = Promise.withResolvers<undefined>()
  readonly calls: GenerateOptions[] = []
  constructor(private readonly reply: string, private readonly suggestion: string) { super() }
  override async listModels(route: string) { return [
    { provider: route, id: model, name: 'Recorded composer model' },
    { provider: route, id: 'composer-alternative', name: 'Recorded alternative model' },
  ] }
  override async resolveModel(route: string, id: string) { return { provider: route, id, name: id, contextWindow: 128000 } }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    const auxiliary = options.messages.length === 1 && options.messages[0]?.role === 'user'
    const gate = auxiliary ? this.predictionRelease : this.normalRelease
    ;(auxiliary ? this.predictionStarted : this.normalStarted).resolve(undefined)
    await gate.promise
    if (options.signal?.aborted) throw options.signal.reason
    const text = auxiliary ? this.suggestion : this.reply
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 17, outputTokens: 5, totalTokens: 22 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it.each(['adopt', 'composition', 'route'] as const)('replays inline prediction ownership: %s', async (variant) => {
  const fixture = join(variant === 'adopt' ? scenario : join(scenario, variant), 'session.v4.jsonl')
  const mode = webSnapshotMode()
  if (mode === 'record') throw new Error('This synthetic scenario uses refresh to record; it never calls a paid provider')
  const recorded = existsSync(fixture) ? parseSessionLog(await readFile(fixture, 'utf8')) : []
  if (recorded.length === 0 && mode !== 'refresh') throw new Error('Missing composer Session fixture; run this case with DSH_SNAPSHOT=refresh')
  const user = recorded.find(e => e.type === 'user/message' && e.data.source.kind === 'user')
  const answer = recorded.find(e => e.type === 'assistant/message')
  const prediction = recorded.find(e => e.type === 'assistant/auxiliary' && e.data.phase === 'result')
  const prompt = user?.type === 'user/message' ? user.data.content.filter(b => b.type === 'text').map(b => b.text).join('') : 'Review the implementation and suggest one verification step.'
  const reply = answer?.type === 'assistant/message' ? answer.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('') : 'The implementation is complete. The next step is to run the targeted checks.'
  const suggestion = prediction?.type === 'assistant/auxiliary' &&
    prediction.data.phase === 'result' ? prediction.data.text : 'Run the targeted checks and report any failures.'
  const adapter = new PredictionAdapter(reply, suggestion)
  const scaffold = await launchWebScaffold({
    profile: { packages: [{ dir: fileURLToPath(new URL('../../../packages/experimental/client-ui-assistants', import.meta.url)),
      enabled: true }] },
  })
  let page: Page | undefined
  const browser = await chromium.launch()
  try {
    scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter([provider], adapter), 'recorded prediction provider')
    await scaffold.ctx.agentDefaultModel.saveSelection({ provider, model })
    page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl)
    await connectFreshWorkspace(page, scaffold.workspaceCwd, 'composer-predictions')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const toggle = page.getByRole('switch', { name: 'Show next-step suggestions', exact: true })
    await toggle.waitFor()
    expect(await toggle.getAttribute('aria-checked')).toBe('false')
    await toggle.click()
    await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
    await page.keyboard.press('Escape')
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    await writeComposerDraft(page, input, prompt)
    const settled = scaffold.whenTurnSettled()
    void settled.catch(() => {})
    await input.press('Enter')
    await expect.poll(() => adapter.calls.length).toBe(1)
    await adapter.normalStarted.promise
    await page.getByRole('button', { name: /^Stop/ }).waitFor({ timeout: 5000 })
    adapter.normalRelease.resolve(undefined)
    const sessionId = await settled
    await expect.poll(() => adapter.calls.length, { timeout: 8000 }).toBe(2)
    await adapter.predictionStarted.promise
    adapter.predictionRelease.resolve(undefined)
    const ghost = page.locator('[data-composer-prediction]')
    await ghost.waitFor()
    expect(await ghost.textContent()).toContain(suggestion)
    const history = scaffold.ctx.sessions.get(sessionId)!
    const userCount = () => history.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.kind === 'user').length
    expect(userCount()).toBe(1)
    expect(adapter.calls).toHaveLength(2)
    const auxiliary = history.snapshotEvents().find(e => e.type === 'assistant/auxiliary' && e.data.phase === 'request')
    expect(auxiliary?.type === 'assistant/auxiliary' &&
      auxiliary.data.phase === 'request' ? auxiliary.data.messages[0]?.content : []).toEqual(adapter.calls[1]!.messages[0]!.content)
    const recordedRequest = recorded.find(e => e.type === 'assistant/auxiliary' && e.data.phase === 'request')
    if (mode === 'replay' && recordedRequest?.type === 'assistant/auxiliary' && recordedRequest.data.phase === 'request') {
      expect(adapter.calls[1]!.messages[0]!.content).toEqual(recordedRequest.data.messages[0]!.content)
    }
    await mkdir(join(process.cwd(), '.plans/composer-predictions-audit/final-browser'), { recursive: true })
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme })
      for (const width of [1280, 680]) {
        await page.setViewportSize({ width, height: 900 })
        await expect.poll(() => ghost.evaluate((element) => {
          const card = element.closest('[data-composer-card]')!
          const editor = card.querySelector<HTMLElement>('[data-composer-input]')!
          const box = element.querySelector('[data-composer-prediction-text]')!.getBoundingClientRect(),
            inputBox = editor.getBoundingClientRect()
          const style = getComputedStyle(editor)
          const expectedX = inputBox.left + parseFloat(style.paddingLeft)
          const expectedY = inputBox.top + parseFloat(style.paddingTop)
          return Math.abs(box.left - expectedX) < 3 && Math.abs(box.top - expectedY) < 3 && box.right <= inputBox.right + 1
        })).toBe(true)
        expect(await page.locator('[data-composer-placeholder]').first().isVisible()).toBe(false)
        await page.screenshot({ path: join('.plans/composer-predictions-audit/final-browser', `${theme}-${width}.png`) })
      }
    }
    await input.evaluate((element) => { element.style.fontSize = '20px'; element.style.lineHeight = '30px' })
    await page.evaluate(() => window.dispatchEvent(new Event('resize')))
    await expect.poll(() => ghost.evaluate(element => getComputedStyle(element).fontSize)).toBe('20px')
    await page.screenshot({ path: join('.plans/composer-predictions-audit/final-browser', 'large-font.png') })
    await input.focus()
    if (variant !== 'adopt') {
      if (variant === 'composition') {
        await input.dispatchEvent('compositionstart', { data: '', bubbles: true })
        await expect.poll(() => ghost.count()).toBe(0)
        await input.dispatchEvent('compositionend', { data: '', bubbles: true })
      } else {
        const trigger = page.getByRole('button', { name: /^Select model, current/ })
        await trigger.click()
        await page.getByRole('menuitem', { name: /^Model\b/ }).click()
        await page.getByRole('menuitemradio', { name: 'Recorded alternative model', exact: true }).click()
        await expect.poll(() => trigger.getAttribute('aria-label')).toContain('Recorded alternative model')
        await expect.poll(() => ghost.count()).toBe(0)
      }
      expect(userCount()).toBe(1)
      expect(adapter.calls).toHaveLength(2)
      if (mode === 'refresh') await recordFixture(scaffold, sessionId, fixture)
      await assertReplaySession([history], fixture, mode, new URL(scaffold.authenticatedUrl).origin, scaffold.harnessHome)
      await page.reload()
      await input.waitFor()
      expect(await ghost.count()).toBe(0)
      expect(adapter.calls).toHaveLength(2)
      expect(tripwire.pageErrors).toEqual([])
      return
    }
    await input.press('Shift+Tab')
    expect(await input.innerText()).toBe('')
    await input.focus()
    await input.dispatchEvent('keydown', { key: 'Tab', code: 'Tab', isComposing: true, bubbles: true })
    expect(await input.innerText()).toBe('')
    await input.evaluate(element => element.setAttribute('data-composer-composing', ''))
    await input.press('Tab')
    expect(await input.innerText()).toBe('')
    await input.evaluate(element => element.removeAttribute('data-composer-composing'))
    await input.press('Tab')
    await expect.poll(() => input.innerText()).toBe(suggestion)
    expect(userCount()).toBe(1)
    expect(adapter.calls).toHaveLength(2)
    if (mode === 'refresh') await recordFixture(scaffold, sessionId, fixture)
    await assertReplaySession([history], fixture, mode, new URL(scaffold.authenticatedUrl).origin, scaffold.harnessHome)
    await page.reload()
    await input.waitFor()
    await expect.poll(() => input.innerText()).toBe(suggestion)
    expect(await ghost.count()).toBe(0)
    expect(adapter.calls).toHaveLength(2)
    expect(tripwire.pageErrors).toEqual([])
  } catch (error) {
    if (page) await saveFailureShot(page, 'composer-predictions')
    throw error
  } finally {
    adapter.normalRelease.resolve(undefined); adapter.predictionRelease.resolve(undefined)
    await browser.close()
    await scaffold.close()
  }
})
