// Browser coverage for schema-driven per-model reasoning declarations, without model calls.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { openSettings, ZH_BROWSER_LOCALE } from './support.ts'

it.each([
  { locale: 'en' as const, browserLocale: 'en-US', settings: 'Settings', models: 'Models', edit: 'Edit', customized: 'Customized settings', options: 'Model options', reasoning: 'Reasoning levels', value: 'API value', level: 'Level', save: 'Apply', cancel: 'Cancel' },
  { locale: 'zh' as const, browserLocale: ZH_BROWSER_LOCALE, settings: '设置', models: '模型', edit: '编辑', customized: '自定义设置', options: '模型选项', reasoning: '推理等级', value: 'API 参数值', level: '档位', save: '保存', cancel: '取消' },
])('edits and reopens model reasoning declarations ($locale)', async (copy) => {
  const scaffold = await launchWebScaffold({})
  const browser = await chromium.launch()
  try {
    await scaffold.ctx.settings.update('llm-pi-ai', {
      providers: {
        'reasoning-fixture': {
          displayName: 'Reasoning Fixture', api: 'openai-completions', baseURL: 'https://reasoning.example.test/v1',
          models: [{ id: 'fixture-think', name: 'Fixture Think', reasoningEfforts: { off: null, high: 'high', max: 'ultra' }, vendorMetadata: { retained: 'unchanged' } }],
        },
      },
    })
    const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: copy.browserLocale })
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSettings(page, copy.locale)
    const dialog = page.getByRole('dialog', { name: copy.settings, exact: true })
    await dialog.getByRole('button', { name: copy.models, exact: true }).click()
    const openEditor = async () => {
      await dialog.getByRole('button', { name: `${copy.edit} Reasoning Fixture (reasoning-fixture)`, exact: true }).click()
      await dialog.getByText(copy.customized, { exact: true }).click()
      await dialog.getByRole('button', { name: `${copy.options} 1`, exact: true }).click()
    }
    await openEditor()
    const group = dialog.getByRole('group', { name: `${copy.reasoning} 1`, exact: true })
    expect(await group.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    expect(await group.getByLabel(`max ${copy.value}`, { exact: true }).inputValue()).toBe('ultra')
    expect(await group.getByLabel(`off ${copy.value}`, { exact: true }).isDisabled()).toBe(true)
    const choices = await group.getByLabel(`${copy.level} 2`, { exact: true }).locator('option').allTextContents()
    expect(choices).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh'])
    await group.getByLabel(`high ${copy.value}`, { exact: true }).fill('deep')
    await dialog.getByRole('button', { name: copy.save, exact: true }).click()
    await group.waitFor({ state: 'detached' })
    const document = () => readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')
    await expect.poll(document).toContain('high: deep')
    expect(await document()).toContain('max: ultra')
    expect(await document()).toContain('off: null')
    expect(await document()).toContain('retained: unchanged')
    await openEditor()
    expect(await group.getByLabel(`high ${copy.value}`, { exact: true }).inputValue()).toBe('deep')
    expect(await group.getByLabel(`max ${copy.value}`, { exact: true }).inputValue()).toBe('ultra')
    await group.getByRole('switch').click()
    await dialog.getByRole('button', { name: copy.save, exact: true }).click()
    await group.waitFor({ state: 'detached' })
    await expect.poll(document).not.toContain('reasoningEfforts:')
    expect(await document()).toContain('retained: unchanged')
    await openEditor()
    expect(await group.getByRole('switch').getAttribute('aria-checked')).toBe('false')
    expect(await group.getByRole('textbox').count()).toBe(0)
    await dialog.getByRole('button', { name: copy.cancel, exact: true }).click()
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  } finally {
    await browser.close()
    await scaffold.close()
  }
}, 120_000)
