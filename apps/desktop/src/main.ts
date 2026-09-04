/** Desktop WebView entry: resolve, handshake, then mount the Client tree. */

import { bootDesktopClient } from './bootstrap.ts'
import { createTauriShellPort } from './harness-port.ts'

const DESKTOP_APP_VERSION = '0.1.2-rc.1'

const root = document.getElementById('root')
if (root === null) throw new Error('desktop WebView is missing #root')

void createTauriShellPort().then(async (port) => {
  const result = await bootDesktopClient({
    port,
    root,
    extensionVersion: DESKTOP_APP_VERSION,
    locale: navigator.language || 'en',
  })
  if (result.status === 'home') return
}).catch((error: unknown) => {
  if (root.textContent === '') {
    root.textContent = error instanceof Error ? error.message : String(error)
  }
})
