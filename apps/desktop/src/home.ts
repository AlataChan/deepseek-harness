/** Shell-owned home shown before the Client tree mounts. */

import { describeDesktopFailure } from './failure.ts'

/** Arguments for the first-run home page. */
export interface HomeViewOptions {
  /** Why the companion is not connected, when known. */
  reason: string
  /**
   * Retry the companion handshake.
   * @returns nothing; the caller owns the next view.
   */
  onStart: () => void | Promise<void>
  /** Open the settings panel without leaving home. */
  onOpenSettings: () => void
}

/**
 * Render the product home. Settings stay closed until the user asks.
 * @param root - application mount point.
 * @param options - status text and the Start / Settings actions.
 * @returns nothing; the page is written into `root`.
 */
export function renderHome(root: HTMLElement, options: HomeViewOptions): void {
  root.replaceChildren()
  const page = document.createElement('div')
  page.className = 'dsh-home'
  page.dataset.testid = 'desktop-home'

  const header = document.createElement('header')
  header.className = 'dsh-home-bar'
  const wordmark = document.createElement('div')
  wordmark.className = 'dsh-home-wordmark'
  wordmark.textContent = 'octopus_DSH'
  const settings = document.createElement('button')
  settings.type = 'button'
  settings.className = 'dsh-home-ghost'
  settings.dataset.testid = 'desktop-settings-open'
  settings.textContent = 'Settings'
  settings.addEventListener('click', () => { options.onOpenSettings() })
  header.append(wordmark, settings)

  const main = document.createElement('main')
  main.className = 'dsh-home-main'
  const title = document.createElement('h1')
  title.className = 'dsh-home-title'
  title.textContent = 'octopus_DSH'
  const lead = document.createElement('p')
  lead.className = 'dsh-home-lead'
  lead.textContent = '基于 DeepSeek Harness 构建'
  main.append(title, lead)

  if (options.reason !== '') {
    const copy = describeDesktopFailure(options.reason)
    const status = document.createElement('p')
    status.className = 'dsh-home-status'
    status.dataset.testid = 'desktop-home-status'
    status.textContent = copy.headline
    const detail = document.createElement('p')
    detail.className = 'dsh-home-lead'
    detail.textContent = copy.detail
    main.append(status, detail)
  }

  const start = document.createElement('button')
  start.type = 'button'
  start.className = 'dsh-home-start'
  start.dataset.testid = 'desktop-home-start'
  start.textContent = 'New session'
  start.addEventListener('click', () => { void options.onStart() })
  main.append(start)

  page.append(header, main)
  root.append(page)
}
