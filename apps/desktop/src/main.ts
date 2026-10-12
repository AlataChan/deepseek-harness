/** Desktop WebView entry: resolve, handshake, then mount the Client tree. */

import { bootDesktopClient } from './bootstrap.ts'
import { createTauriShellPort } from './harness-port.ts'

const DESKTOP_APP_VERSION = '0.1.2-rc.1'

/** When the static first-start hint replaces the waiting line. */
const STILL_STARTING_AFTER_MS = 20_000
const STILL_STARTING_TEXT = '仍在启动：首次启动要复制组件文件，请保持窗口打开。'

const root = document.getElementById('root')
if (root === null) throw new Error('desktop WebView is missing #root')

/**
 * Replace the root with one shell-owned status paragraph.
 * @param text - status line to show.
 */
function showStatus(text: string): void {
  const status = document.createElement('p')
  status.className = 'dsh-boot-status'
  status.textContent = text
  root.replaceChildren(status)
}

void createTauriShellPort().then(async (port) => {
  // One-shot: the status node stays in the document only while no view has
  // replaced the root children, so a mounted home or Client tree is never
  // overwritten.
  const stillStarting = setTimeout(() => {
    const status = document.querySelector('.dsh-boot-status')
    if (status !== null) status.textContent = STILL_STARTING_TEXT
  }, STILL_STARTING_AFTER_MS)
  try {
    const result = await bootDesktopClient({
      port,
      root,
      extensionVersion: DESKTOP_APP_VERSION,
      locale: navigator.language || 'en',
    })
    if (result.status === 'home') return
  } finally {
    clearTimeout(stillStarting)
  }
}).catch((error: unknown) => {
  showStatus(error instanceof Error ? error.message : String(error))
})
