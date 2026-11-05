/** Keyless browser evidence for the one Automation Tasks page and its human controls. */
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

class ScheduleManualAdapter extends LlmAdapter {
  override async listModels(provider: string) { return [{ provider, id: 'reply', name: 'Schedule test reply' }] }
  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = 'Scheduled inspection complete.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
let scaffold: WebScaffold
let browser: Browser
let page: Page
beforeAll(async () => {
  scaffold = await launchWebScaffold()
  scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter(['schedule-manual-test'], new ScheduleManualAdapter()))
  await scaffold.ctx.agentDefaultModel.saveSelection({ provider: 'schedule-manual-test', model: 'reply' })
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'en-US' })
  await page.addInitScript(() => { localStorage.setItem('dsh.locale', 'en') })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]')
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
}, 60_000)
afterAll(async () => { await browser?.close(); await scaffold?.close() })
it('manually creates, edits, runs, reads history and clears ended tasks through the single page', async () => {
  const entry = page.getByRole('button', { name: 'Automation tasks', exact: true })
  expect(await entry.count()).toBe(1)
  await entry.click()
  const manager = page.getByTestId('task-manager-page')
  await manager.getByRole('button', { name: 'Create manually', exact: true }).click()
  let form = manager.getByRole('complementary', { name: 'Create automation task' })
  await form.getByLabel('Automation task name', { exact: true }).fill('Manual inspection')
  await form.getByLabel('Automation task instruction', { exact: true }).fill('Inspect the service status')
  await form.getByLabel('Seconds', { exact: true }).fill('86400')
  await form.getByLabel('Workspace directory (optional)', { exact: true }).fill(scaffold.workspaceCwd)
  await form.getByRole('button', { name: 'Create task', exact: true }).click()
  await expect.poll(async () => (await scaffold.ctx.schedule.list()).total).toBe(1)
  const task = (await scaffold.ctx.schedule.list()).items[0]
  if (task === undefined) throw new Error('Manual create stored no task')
  expect(task.target.kind).toBe('new_once')
  if (task.target.kind !== 'new_once') throw new Error('Expected reserved new_once target')
  let detail = manager.getByRole('complementary', { name: 'Task details' })
  await detail.getByLabel('Automation task name', { exact: true }).fill('Revised inspection')
  await detail.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(async () => (await scaffold.ctx.schedule.view({ id: task.id }))).toMatchObject({ title: 'Revised inspection' })
  await detail.getByRole('button', { name: 'Run now', exact: true }).click()
  await expect.poll(async () => (await scaffold.ctx.schedule.history({ id: task.id, limit: 20 })))
    .toHaveProperty('records.0.targetSessionId', task.target.sessionId)
  const current = await scaffold.ctx.schedule.view({ id: task.id })
  if (!('target' in current) || current.target.kind !== 'session') throw new Error('Run did not reuse its reserved target')
  const active = scaffold.ctx.agents.get(current.target.sessionId)
  expect(active?.session.snapshotEvents().some(event => event.type === 'agent/inbox/spliced'
    && JSON.stringify(event.data).includes('"kind":"schedule"'))).toBe(true)
  await detail.getByRole('tab', { name: 'Records', exact: true }).click()
  await detail.getByRole('tabpanel', { name: 'Records', exact: true })
    .getByText('Inspect the service status', { exact: true }).waitFor()
  await manager.getByRole('button', { name: 'Create manually', exact: true }).click()
  form = manager.getByRole('complementary', { name: 'Create automation task' })
  await form.getByLabel('Automation task name', { exact: true }).fill('Short task')
  await form.getByLabel('Automation task instruction', { exact: true }).fill('Finish the short inspection')
  await form.getByLabel('Seconds', { exact: true }).fill('1')
  await form.getByLabel('Workspace directory (optional)', { exact: true }).fill(scaffold.workspaceCwd)
  await form.getByRole('button', { name: 'Create task', exact: true }).click()
  await expect.poll(async () => (await scaffold.ctx.schedule.catalog()).filter(value => value.status === 'ended').length,
    { timeout: 5_000 }).toBe(1)
  await manager.getByRole('button', { name: 'Clear ended tasks', exact: true }).click()
  await expect.poll(async () => (await scaffold.ctx.schedule.catalog()).map(value => value.id)).toEqual([task.id])
  detail = manager.getByRole('complementary', { name: 'Task details' })
  expect(await manager.getByRole('heading', { name: 'Automation tasks', exact: true }).count()).toBe(1)
}, 60_000)
