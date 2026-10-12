/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.doUnmock('../src/harness-port.ts')
  vi.resetModules()
  document.body.replaceChildren()
})

describe('desktop WebView entry', () => {
  it('replaces the boot status line with the failure reason when the shell port cannot start', async () => {
    document.body.innerHTML = '<div id="root"><p class="dsh-boot-status">正在启动</p></div>'
    vi.doMock('../src/harness-port.ts', () => ({
      createTauriShellPort: () => Promise.reject(new Error('tauri IPC unavailable')),
    }))
    await import('../src/main.ts')
    await vi.waitFor(() => {
      expect(document.querySelector('.dsh-boot-status')?.textContent).toBe('tauri IPC unavailable')
    })
    expect(document.querySelectorAll('.dsh-boot-status')).toHaveLength(1)
    expect(document.querySelector('[data-testid="desktop-home"]')).toBeNull()
  })
})
