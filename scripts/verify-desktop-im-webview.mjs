/** Installed IM settings discovery and Client disposal through the production desktop page. */
import assert from 'node:assert/strict'

/** Exercise the installed settings section without opening a platform connection.
 * @param page - Production desktop page connected to the native carrier.
 * @param remote - Installed Host RPC invocation.
 * @returns Completion after settings discovery and live reload.
 */
export async function verifyDesktopImSection(page, remote) {
  const waitForSection = async present => page.waitForFunction(expected => {
    const rows = window.__nativeModules.entries.loader.ctx.get('slots').entries('settings.section')
    return rows.some(row => row.options.id === 'desktop-im') === expected
  }, present)
  const open = async () => {
    await page.getByRole('button', { name: /^(Settings|设置)$/ }).first().click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: /^(IM 接入|IM integrations)$/ }) })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: /^(IM 接入|IM integrations)$/ }).click()
    await dialog.getByRole('heading', { name: /^(飞书|Feishu)$/ }).waitFor()
    await dialog.getByRole('heading', { name: /^(钉钉|DingTalk)$/ }).waitFor()
    assert.equal(await dialog.locator('input[type=password]').count(), 2)
    assert.equal(await dialog.getByRole('button', { name: /^(选择工作目录|Choose workspace folder)$/ }).count(), 2)
    await dialog.getByRole('combobox', { name: /模型服务商|Model provider/ }).first().selectOption('deepseek-official')
    await dialog.locator('datalist option').first().waitFor({ state: 'attached' })
  }
  await waitForSection(true)
  const notice = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /^(Preview Notice|预览.*)$/ }) })
  await notice.waitFor()
  await notice.getByRole('button', { name: /^(Continue|继续)$/ }).click()
  await notice.waitFor({ state: 'hidden' })
  await open()
  assert((await remote('desktopIm/list')).every(row => row.enabled === false))
  await page.screenshot({ path: '/tmp/dsh-im-native-settings.png' })
  await page.keyboard.press('Escape')
  const name = '@deepseek-ai/dsh-experimental-desktop-im'
  assert.equal((await remote('pluginManager/setBundleEnabled', { name, enabled: false })).application, 'applied')
  await waitForSection(false)
  assert.equal((await remote('pluginManager/setBundleEnabled', { name, enabled: true })).application, 'applied')
  await waitForSection(true)
  await open()
  await page.keyboard.press('Escape')
  console.log('READY: installed IM settings discovered, rendered both channel forms and survived live disposal/reload')
}
