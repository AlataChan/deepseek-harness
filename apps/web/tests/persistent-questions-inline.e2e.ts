/** Real browser answer controls over the shipped Client and a real question-producing Host turn. */
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { compareOrRefreshGolden, readPersistedEvents, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'
import {
  durableWorld, enteredUserTexts, installAdapter, launchQuestions, remoteGet,
  settleSession, soleDecision, textChunks, toolCallChunks,
} from './persistent-questions.fixture.ts'
import { fileURLToPath } from 'node:url'

it('shows inline answer buttons without opening a header popover, survives reload, and admits the clicked choice once', async () => {
  const { roots } = await durableWorld()
  const scaffold = await launchQuestions(roots)
  onTestFinished(() => scaffold.close())
  const adapter = await installAdapter(scaffold, [
    toolCallChunks([{ id: 'inline-card-ask', name: 'request_persistent_question',
      args: { question: 'Which environment should I deploy to?', choices: ['Staging', 'Production'], ttlMs: 600000 } }]),
    textChunks('Selected Staging.'),
  ])
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  await page.getByRole('button', { name: 'Standard mode', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Persistent questions/ }).click()
  const input = page.locator('[data-composer-input][contenteditable="true"]').first()
  await input.fill('Ask me to choose an environment using the persistent question tool.')
  await input.press('Enter')
  const card = page.locator('[data-session-question]').first()
  await card.waitFor({ state: 'visible', timeout: 20000 }).catch(async (error: unknown) => {
    await page.screenshot({ path: '/tmp/dsh-persistent-question-inline-failed.png', fullPage: true })
    throw error
  })
  const staging = card.getByRole('button', { name: 'Staging', exact: true })
  await staging.waitFor({ state: 'visible', timeout: 20000 })
  const list = await scaffold.ctx.sessionController.list({}, new AbortController().signal)
  const sessionId = list.items.find(item => item.projections?.values.agentPreset === 'persistent-questions')?.sessionId
  if (sessionId === undefined) throw new Error('Selected question Session was not created')
  const decision = await soleDecision(scaffold, sessionId)
  const visible = {
    question: await card.locator('p').first().textContent(),
    answerButtons: await card.getByRole('button').allTextContents(),
    headerDialogCount: await page.getByRole('dialog', { name: 'Question awaiting your answer' }).count(),
  }
  await compareOrRefreshGolden(fileURLToPath(new URL('./expected/persistent-questions-inline/choice-controls.expected.json', import.meta.url)), JSON.stringify(visible, null, 2), webSnapshotMode())
  await page.screenshot({ path: '/tmp/dsh-persistent-question-inline.png', fullPage: true })
  await page.reload()
  await staging.waitFor({ state: 'visible', timeout: 20000 })
  await staging.click()
  await expect.poll(async () => (await remoteGet(scaffold, decision.decisionId))?.answerIndex).toBe('admitted')
  await settleSession(scaffold, sessionId)
  const events = await readPersistedEvents(scaffold, SessionId(sessionId))
  const answers = enteredUserTexts(events).filter(text => text.startsWith(`Answer to question ${decision.decisionId}:`))
  expect(answers).toHaveLength(1)
  expect(answers[0]).toBe(`Answer to question ${decision.decisionId}: option 1`)
  expect(decision.choices[0]).toBe('Staging')
  expect(adapter.calls).toHaveLength(2)
  await page.getByText('Selected Staging.', { exact: true }).waitFor()
}, 120000)
