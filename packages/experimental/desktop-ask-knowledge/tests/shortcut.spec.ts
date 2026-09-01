/** Workspace symlink and reveal. */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createCatalogLibrary } from '../src/catalog.ts'
import { placeLibraryShortcut, revealLibraryVault } from '../src/shortcut.ts'

const opened: string[] = []
let canOpen = true

vi.mock('@deepseek-ai/dsh-native-command', () => ({
  canOpenNativePath: () => canOpen,
  openNativePath: async (path: string) => {
    opened.push(path)
  },
}))

describe('ask-knowledge shortcut', () => {
  it('reveals a vault when the host can open a folder', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-reveal-'))
    const created = await createCatalogLibrary(home, '揭示')
    await revealLibraryVault(home, created.id)
    expect(opened.some(path => path.includes(created.id))).toBe(true)
    const ctx = new Context()
    const missing = await placeLibraryShortcut(ctx, home, created.id, 'ws' as never)
    expect(missing.ok).toBe(false)
    canOpen = false
    await expect(revealLibraryVault(home, created.id)).rejects.toMatchObject({ code: 'not-ready' })
    const blank = await createCatalogLibrary(home, '   库   ')
    ctx.provide('workspaceRegistry', { get: () => ({ path: home }) })
    const placed = await placeLibraryShortcut(ctx, home, blank.id, 'ws' as never)
    expect(placed.ok).toBe(true)
  })
})
