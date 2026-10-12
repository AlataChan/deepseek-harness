/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'

/** The static `#root` markup from index.html: waiting line plus hidden hint. */
const BOOT_MARKUP = [
  '<div id="root">',
  '<div class="dsh-boot-status">',
  '<p>正在启动</p>',
  '<p data-testid="desktop-boot-still-starting" hidden>仍在启动</p>',
  '</div>',
  '</div>',
].join('')

afterEach(() => {
  vi.doUnmock('../src/harness-port.ts')
  vi.resetModules()
  document.body.replaceChildren()
})

describe('desktop WebView entry', () => {
  it('replaces the boot status line with the failure reason when the shell port cannot start', async () => {
    document.body.innerHTML = BOOT_MARKUP
    vi.doMock('../src/harness-port.ts', async importOriginal => ({
      ...await importOriginal<typeof import('../src/harness-port.ts')>(),
      createTauriShellPort: () => Promise.reject(new Error('tauri IPC unavailable')),
    }))
    await import('../src/main.ts')
    await vi.waitFor(() => {
      expect(document.querySelector('.dsh-boot-status')?.textContent).toBe('tauri IPC unavailable')
    })
    expect(document.querySelectorAll('.dsh-boot-status')).toHaveLength(1)
    expect(document.querySelector('[data-testid="desktop-boot-still-starting"]')).toBeNull()
    expect(document.querySelector('[data-testid="desktop-home"]')).toBeNull()
  })

  it('un-hides the first-start hint after 20 s while the boot is still pending', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      document.body.innerHTML = BOOT_MARKUP
      vi.doMock('../src/harness-port.ts', async importOriginal => ({
        ...await importOriginal<typeof import('../src/harness-port.ts')>(),
        createTauriShellPort: () => Promise.resolve({
          invoke: () => new Promise(() => {}),
          createChannel: () => ({}),
        }),
      }))
      await import('../src/main.ts')
      // Let the entry chain register its timer without advancing the clock.
      for (let round = 0; round < 10; round += 1) {
        if (vi.getTimerCount() > 0) break
        await Promise.resolve()
      }
      expect(vi.getTimerCount()).toBeGreaterThan(0)
      const hint = document.querySelector<HTMLElement>('[data-testid="desktop-boot-still-starting"]')
      expect(hint?.hidden).toBe(true)
      await vi.advanceTimersByTimeAsync(19_999)
      expect(hint?.hidden).toBe(true)
      await vi.advanceTimersByTimeAsync(1)
      expect(hint?.hidden).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
