// Keyless assembled-browser coverage for the opt-in Agent Teams bundle.
// The header opens the right collaboration dock; the dock polls its own Team view.
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type {} from '@deepseek-ai/dsh-experimental-agent-team'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  assertFixtureInventory, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/agent-team-panel', import.meta.url))
const OVERLAY = fileURLToPath(new URL('./agent-team-panel.overlay.yml', import.meta.url))
const TEAM_PATCH = fileURLToPath(new URL('../../../packages/experimental/agent-team-profile/cordis.patch.yml', import.meta.url))
const INSTALL_ANCHORS = [
  fileURLToPath(new URL('../../../packages/experimental/agent-team-profile/package.json', import.meta.url)),
]
const MODE = webSnapshotMode()

function teamTrigger(page: Page): Locator {
  return page.locator('[data-team-action]').getByRole('button', { name: 'Team', exact: true })
}

function teamDock(page: Page): Locator {
  return page.locator('[data-team-dock]')
}

/** Open the header collaboration dock. A second call leaves an already-open dock open. */
async function openTeamDock(page: Page): Promise<Locator> {
  const trigger = teamTrigger(page)
  await trigger.waitFor({ timeout: 30_000 })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  const dock = teamDock(page)
  await dock.waitFor({ timeout: 15_000 })
  expect(await dock.getAttribute('role')).toBe('dialog')
  expect(await dock.getAttribute('aria-label')).toBe('Team')
  expect(await dock.evaluate(element => element.parentElement === document.body)).toBe(true)
  return dock
}

async function dockBox(dock: Locator): Promise<{
  readonly withinViewport: boolean
  readonly width: number
  readonly rightGap: number
}> {
  return await dock.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const max = Math.max(280, Math.floor(window.innerWidth * 0.55))
    return {
      withinViewport: rect.top >= -1
        && rect.left >= -1
        && rect.right <= window.innerWidth + 1
        && rect.bottom <= window.innerHeight + 1
        && rect.width >= 279
        && rect.width <= max + 1
        && Math.abs(rect.right - window.innerWidth) <= 2,
      width: rect.width,
      rightGap: window.innerWidth - rect.right,
    }
  })
}

function profileEntries(path: string): unknown[] {
  const parsed = yaml.load(readFileSync(path, 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error(`profile layer at ${path} must be a list`)
  return parsed
}

describe('Agent Teams panel overlay', () => {
  it('matches the shipped Agent Teams bundle', () => {
    expect(profileEntries(OVERLAY)).toEqual(profileEntries(TEAM_PATCH))
  })
})

describe('web e2e: Agent Teams panel', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, extraInstallAnchors: INSTALL_ANCHORS })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const agent = scaffold.ctx.agents.list()[0]
    if (agent === undefined) throw new Error('connected Team workspace did not create an Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Open the Agent Team controls.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'Ready.' }],
        source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      }),
    }, { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(agent.session)
    await page.getByText('Ready.').waitFor({ timeout: 10_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows persisted tasks in the collaboration dock through its own polling', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-team-panel'))
    const dock = await openTeamDock(page)
    await dock.getByText('No shared tasks yet', { exact: true }).waitFor()
    // The lead row is a disabled button, so role queries that skip disabled controls miss it.
    await dock.locator('button').filter({ hasText: 'Coordinator Session' }).waitFor()
    expect(await dock.getByRole('button', { name: 'New task', exact: true }).count()).toBe(1)
    expect(await dock.getByRole('button', { name: 'Refresh roster', exact: true }).count()).toBe(1)

    const agent = scaffold.ctx.agents.list()[0]!
    const task = await scaffold.ctx.agentTeams.createTask(agent, {
      subject: 'Agent task', description: 'Created by the Team Lead', writeScopes: ['src/web'],
    })
    const card = dock.locator('article').filter({ hasText: 'Agent task' })
    await card.waitFor({ timeout: 15_000 })
    await card.getByText('Owner: Unowned', { exact: true }).waitFor()
    await card.getByText('Write scopes: src/web', { exact: true }).waitFor()
    await scaffold.ctx.agentTeams.updateTask(agent, {
      taskId: task.id, expectedRevision: task.revision, action: 'claim',
    })
    await card.getByText('In progress', { exact: true }).waitFor({ timeout: 15_000 })
    await card.getByText('Owner: lead', { exact: true }).waitFor()
    expect(await card.getByRole('button', { name: 'Edit', exact: true }).count()).toBe(1)
    expect(await card.getByRole('button', { name: 'Complete', exact: true }).count()).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await dock.getByRole('button', { name: 'Close', exact: true }).click()
    await dock.waitFor({ state: 'detached' })
  }, 60_000)

  it('keeps the dock inside the viewport, resizes from its handle, and closes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-team-panel-keyboard'))
    const trigger = teamTrigger(page)
    const viewport = page.viewportSize()!
    const dock = await openTeamDock(page)
    try {
      await dock.locator('button').filter({ hasText: 'Coordinator Session' }).waitFor()
      for (const size of [{ width: 760, height: 540 }, { width: 600, height: 420 }]) {
        await page.setViewportSize(size)
        await expect.poll(() => dockBox(dock)).toMatchObject({ withinViewport: true, rightGap: 0 })
      }
      await page.setViewportSize(viewport)
      const before = (await dockBox(dock)).width
      const handle = dock.getByRole('separator', { name: 'Drag to resize dock', exact: true })
      const box = await handle.boundingBox()
      if (box === null) throw new Error('collaboration dock has no resize handle')
      await page.mouse.move(box.x + box.width / 2, box.y + 80)
      await page.mouse.down()
      await page.mouse.move(box.x - 80, box.y + 80, { steps: 8 })
      await page.mouse.up()
      await expect.poll(async () => (await dockBox(dock)).width).toBeGreaterThan(before + 40)
      expect((await dockBox(dock)).withinViewport).toBe(true)

      await dock.getByRole('heading', { name: 'Shared tasks', exact: true }).click()
      expect(await dock.count()).toBe(1)
      await page.locator('[data-team-dock-backdrop]').click({ position: { x: 8, y: 8 } })
      await dock.waitFor({ state: 'detached' })
      expect(await trigger.getAttribute('aria-expanded')).toBe('false')

      await trigger.click()
      await dock.waitFor()
      await page.keyboard.press('Escape')
      await dock.waitFor({ state: 'detached' })

      await trigger.click()
      await dock.waitFor()
      await dock.getByRole('button', { name: 'Close', exact: true }).click()
      await dock.waitFor({ state: 'detached' })
      expect(await trigger.getAttribute('aria-expanded')).toBe('false')
    } finally {
      await page.setViewportSize(viewport)
      if (await teamDock(page).count() > 0) {
        await teamDock(page).getByRole('button', { name: 'Close', exact: true }).click()
      }
    }
  })

  it('opens the dock on click and keeps it open when the pointer leaves', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-team-panel-hover'))
    const trigger = teamTrigger(page)
    const dock = teamDock(page)
    if (await dock.count() > 0) {
      await dock.getByRole('button', { name: 'Close', exact: true }).click()
      await dock.waitFor({ state: 'detached' })
    }
    await trigger.hover()
    await page.waitForTimeout(180)
    expect(await dock.count()).toBe(0)
    await trigger.click()
    await dock.waitFor()
    await page.mouse.move(8, 8)
    await page.waitForTimeout(180)
    expect(await dock.count()).toBe(1)
    await dock.getByRole('button', { name: 'Close', exact: true }).click()
    await dock.waitFor({ state: 'detached' })
  })

  it('keeps a persisted task description while the dock is resized', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-agent-team-panel-resize'))
    const description = 'Check the task description before you start work. '.repeat(3)
    const agent = scaffold.ctx.agents.list()[0]!
    await scaffold.ctx.agentTeams.createTask(agent, {
      subject: 'Responsive task',
      description,
      writeScopes: [],
    })
    const viewport = page.viewportSize()!
    const dock = await openTeamDock(page)
    const card = dock.locator('article').filter({ hasText: 'Responsive task' })
    await card.waitFor({ timeout: 15_000 })
    const renderedDescription = async (): Promise<string> => card.locator('p').innerText()
    expect(await renderedDescription()).toContain('Check the task description before you start work.')
    expect((await renderedDescription()).match(/Check the task description before you start work\./g)?.length).toBe(3)
    expect(await card.getByRole('button', { name: 'Show more' }).count()).toBe(0)
    try {
      const before = (await dockBox(dock)).width
      const handle = dock.getByRole('separator', { name: 'Drag to resize dock', exact: true })
      const box = await handle.boundingBox()
      if (box === null) throw new Error('collaboration dock has no resize handle')
      await page.mouse.move(box.x + box.width / 2, box.y + 120)
      await page.mouse.down()
      await page.mouse.move(box.x + 70, box.y + 120, { steps: 6 })
      await page.mouse.up()
      await expect.poll(async () => (await dockBox(dock)).width).toBeLessThan(before - 40)
      expect((await renderedDescription()).match(/Check the task description before you start work\./g)?.length).toBe(3)
      await page.setViewportSize({ width: 360, height: 700 })
      await expect.poll(() => dockBox(dock)).toMatchObject({ withinViewport: true })
      expect(await card.getByRole('button', { name: 'Show more' }).count()).toBe(0)
      expect((await renderedDescription()).match(/Check the task description before you start work\./g)?.length).toBe(3)
    } finally {
      await page.setViewportSize(viewport)
      if (await dock.count() > 0) {
        await dock.getByRole('button', { name: 'Close', exact: true }).click()
      }
    }
  })

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [])
  })
})
