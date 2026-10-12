/** Desktop WebView entry: resolve, handshake, then mount the Client tree. */

import { bootDesktopClient } from './bootstrap.ts'
import { createTauriShellPort } from './harness-port.ts'

const DESKTOP_APP_VERSION = '0.1.2-rc.1'

/** When the static first-start hint becomes visible. */
const STILL_STARTING_AFTER_MS = 20_000

const found = document.getElementById('root')
if (found === null) throw new Error('desktop WebView is missing #root')
const root: HTMLElement = found

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
  // One-shot: the hint stays in the document only while no view has replaced
  // the root children, so a mounted home or Client tree is never touched.
  const stillStarting = setTimeout(() => {
    const hint = document.querySelector<HTMLElement>('[data-testid="desktop-boot-still-starting"]')
    if (hint !== null) hint.hidden = false
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
