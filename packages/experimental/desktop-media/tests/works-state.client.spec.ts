import { describe, expect, it } from 'vitest'
import { setWorksOpen, subscribeWorks, worksOpen } from '../src/client/works-state.ts'

describe('works-state', () => {
  it('notifies subscribers only when the flag changes', () => {
    setWorksOpen(false)
    const ticks: boolean[] = []
    const dispose = subscribeWorks(() => { ticks.push(worksOpen()) })
    setWorksOpen(false)
    expect(ticks).toEqual([])
    setWorksOpen(true)
    expect(worksOpen()).toBe(true)
    expect(ticks).toEqual([true])
    setWorksOpen(false)
    expect(ticks).toEqual([true, false])
    dispose()
    setWorksOpen(true)
    expect(ticks).toEqual([true, false])
    setWorksOpen(false)
  })
})
