/** Workspace trust, initial selection, and disruptive-root confirmation. */

import { describe, expect, it, vi } from 'vitest'
import { chooseInitialWorkspace, chooseReplacementWorkspace } from '../src/workspace-selector.ts'

describe('VS Code workspace selection', () => {
  it('does not select or launch from an untrusted workspace', async () => {
    await expect(chooseInitialWorkspace({ trusted: false, folders: ['/workspace'] }))
      .rejects.toThrow(/trust/i)
  })

  it('selects one root directly and asks among multiple attached folders', async () => {
    await expect(chooseInitialWorkspace({ trusted: true, folders: ['/one'] })).resolves.toBe('/one')
    const pick = vi.fn(async () => '/two')
    await expect(chooseInitialWorkspace({ trusted: true, folders: ['/one', '/two'], pick })).resolves.toBe('/two')
    expect(pick).toHaveBeenCalledWith(['/one', '/two'])
  })

  it('confirms a restart only while a turn is running', async () => {
    const confirm = vi.fn(async () => false)
    await expect(chooseReplacementWorkspace({
      current: '/one', selected: '/two', turnRunning: true, confirm,
    })).resolves.toBeUndefined()
    expect(confirm).toHaveBeenCalledOnce()

    confirm.mockClear()
    await expect(chooseReplacementWorkspace({
      current: '/one', selected: '/two', turnRunning: false, confirm,
    })).resolves.toBe('/two')
    expect(confirm).not.toHaveBeenCalled()
  })
})
