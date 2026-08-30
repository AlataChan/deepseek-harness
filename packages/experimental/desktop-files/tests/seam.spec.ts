/** Provider registration on the official workspace-entries seam. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DesktopWorkspaceEntries from '../src/index.ts'

describe('DesktopWorkspaceEntries', () => {
  it('registers as ctx.workspaceEntries and leaves with its fiber', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(DesktopWorkspaceEntries)
    await fiber.await()
    expect(ctx.get('workspaceEntries')).toBeInstanceOf(DesktopWorkspaceEntries)
    await fiber.dispose()
    expect(ctx.get('workspaceEntries')).toBeUndefined()
  })
})
