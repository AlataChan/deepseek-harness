/** Changing workspace cwd does not hide the global catalog row. */

import { afterEach, describe, expect, it } from 'vitest'
import { bootOverlay } from './helpers/boot.ts'

const cleanups: Array<() => Promise<void> | void> = []
const originalCwd = process.cwd()

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
  process.chdir(originalCwd)
})

describe('ask-knowledge workspace switch', () => {
  it('lists the same library id after cwd changes', async () => {
    const started = await bootOverlay({ sessions: false })
    cleanups.push(() => started.fiber.dispose())
    const created = await started.ctx.askKnowledge.createLibrary({ displayName: '跨工作区' })
    process.chdir(started.root)
    const listed = await started.ctx.askKnowledge.listLibraries()
    expect(listed.map(row => row.id)).toEqual([created.id])
    expect(listed[0]?.displayName).toBe('跨工作区')
  })
})
