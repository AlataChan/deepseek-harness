/** Explicit pin choices survive registration churn within one sidebar lifetime. */
import { expect, it, vi } from 'vitest'
import { createPanelPins, FIXED_PANEL_ID } from '../src/client/panel-pins.ts'

it('publishes only changed pin choices and keeps unknown ids until explicitly repinned', () => {
  const pins = createPanelPins()
  const initial = pins.unpinned.getSnapshot()
  const changed = vi.fn()
  const stop = pins.unpinned.subscribe(changed)
  try {
    pins.setPinned(FIXED_PANEL_ID, false)
    pins.setPinned('late-plugin', true)
    expect(pins.unpinned.getSnapshot()).toBe(initial)
    expect(changed).not.toHaveBeenCalled()
    pins.setPinned('late-plugin', false)
    const unpinned = pins.unpinned.getSnapshot()
    expect(unpinned).toEqual(['late-plugin'])
    pins.setPinned('late-plugin', false)
    expect(pins.unpinned.getSnapshot()).toBe(unpinned)
    expect(changed).toHaveBeenCalledOnce()
    pins.setPinned('second-plugin', false)
    pins.setPinned('late-plugin', true)
    expect(pins.unpinned.getSnapshot()).toEqual(['second-plugin'])
    expect(changed).toHaveBeenCalledTimes(3)
    expect(createPanelPins().unpinned.getSnapshot()).toEqual([])
  } finally { stop() }
  pins.setPinned('second-plugin', true)
  expect(changed).toHaveBeenCalledTimes(3)
})
