import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const BASE_PATCH = fileURLToPath(new URL('../../base/cordis.patch.yml', import.meta.url))
const WEB_APP_PATCH = fileURLToPath(new URL('../../web-app/cordis.patch.yml', import.meta.url))
const DESKTOP_APP_PATCH = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))

describe('the desktop bundle patch', () => {
  it('composes desktop rows over base and web-app and disables web-startup', () => {
    const rows = composeEntries([
      loadOverlayPatches('test', BASE_PATCH),
      loadOverlayPatches('test', WEB_APP_PATCH),
      loadOverlayPatches('test', DESKTOP_APP_PATCH),
    ])
    const ids = rows.map(row => row.id)
    expect(ids).toEqual(expect.arrayContaining([
      'desktop-startup', 'desktop-runtime', 'connection-desktop',
      'directory-picker-browse', 'ui-directory-picker-browse',
      'webserver', 'connection', 'modules',
    ]))
    expect(rows.find(row => row.id === 'web-startup')?.disabled).toBe(true)
    expect(rows.find(row => row.id === 'client-hmr')?.disabled).toBe(true)
    expect(rows.find(row => row.id === 'directory-picker')?.disabled).toBe(true)
    expect(ids.indexOf('desktop-startup')).toBeLessThan(ids.indexOf('connection-desktop'))
    expect(rows.find(row => row.id === 'connection-desktop')?.inject).toEqual([
      'desktopStartup', 'connection', 'clientModules', 'typertGateway',
    ])
  })
})
