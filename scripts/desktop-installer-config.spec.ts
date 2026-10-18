/** Shipped Windows installer policy and its native acceptance entry point. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('ships the transaction installer with downgrade refusal explicitly enabled', () => {
  const config = JSON.parse(readFileSync(new URL('../apps/desktop/src-tauri/tauri.windows.conf.json', import.meta.url), 'utf8'))
  expect(config).toMatchObject({
    bundle: {
      windows: {
        allowDowngrades: false,
        nsis: {
          template: '../../../scripts/desktop-installer-template.nsi',
          installerHooks: '../../../scripts/desktop-installer-transaction.nsh',
        },
      },
    },
  })
})
