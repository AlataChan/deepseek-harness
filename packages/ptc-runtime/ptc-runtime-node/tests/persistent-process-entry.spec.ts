/** Arg forwarding for the retained Node bootstrap entry. */
import { afterEach, describe, expect, it, vi } from 'vitest'

const openInheritedControlChannel = vi.hoisted(() => vi.fn(() => ({ fd: 7 })))
const runPersistentMain = vi.hoisted(() => vi.fn(() => Promise.resolve()))

vi.mock('@deepseek-ai/dsh-subprocess/control', () => ({
  openInheritedControlChannel,
}))

vi.mock('../src/persistent-process.ts', () => ({
  runPersistentMain,
}))

describe('persistent process entry', () => {
  afterEach(() => {
    openInheritedControlChannel.mockClear()
    runPersistentMain.mockClear()
  })

  it('forwards the inherited channel, argv limit, and process to the retained bootstrap', async () => {
    const previous = process.argv[2]
    process.argv[2] = '8192'
    try {
      await import('../src/persistent-process-entry.ts')
      expect(openInheritedControlChannel).toHaveBeenCalledOnce()
      expect(runPersistentMain).toHaveBeenCalledWith({ fd: 7 }, 8192, process)
    } finally {
      if (previous === undefined) process.argv.splice(2, 1)
      else process.argv[2] = previous
    }
  })
})
