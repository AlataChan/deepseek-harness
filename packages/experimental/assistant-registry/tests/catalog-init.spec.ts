/**
 * Loader-level verification for catalog initialization: awaited opening, early mutations,
 * lease failures, late storage dependencies, and orderly disposal.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it, vi } from 'vitest'
import AssistantService from '../src/index.ts'
import { AssistantCatalog } from '../src/catalog.ts'
import { CatalogAlreadyOwnedError } from '../src/errors.ts'

function provideRuntimeStubs(ctx: Context): void {
  const disposeNoop = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: () => disposeNoop },
    contexts: { configureHost: () => disposeNoop },
  } as never)
}

async function mountStorage(ctx: Context, root: string): Promise<void> {
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storages') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
}

describe('Assistant registry catalog initialization through the Loader', () => {
  it('persists an early mutation that arrives while the catalog is still opening', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-asst-init-'))
    const ctx = new Context()
    try {
      provideRuntimeStubs(ctx)
      await mountStorage(ctx, root)
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const actualOpen = AssistantCatalog.open.bind(AssistantCatalog)
      const openSpy = vi.spyOn(AssistantCatalog, 'open').mockImplementation(async (...args) => {
        await gate
        return actualOpen(...args)
      })
      const fiber = ctx.plugin(AssistantService, { lockPath: join(root, 'storages', 'assistants.lock') })
      await Promise.resolve()
      await Promise.resolve()
      const service = ctx.get('assistants')
      try {
        expect(service).toBeDefined()
        const creation = service!.createProfile({ name: 'During opening', responsibility: 'Must persist' })
        release()
        await fiber
        const created = await creation
        expect(service!.catalog?.getProfile(created.id)).toMatchObject({ name: 'During opening' })
      } finally {
        release()
        await fiber
        openSpy.mockRestore()
      }
    } finally {
      await ctx.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails plugin loading when another writer already holds the catalog lease', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-asst-lease-'))
    const ctx = new Context()
    try {
      provideRuntimeStubs(ctx)
      await mountStorage(ctx, root)
      const lockPath = join(root, 'storages', 'assistants.lock')
      const holder = await AssistantCatalog.open(ctx, { lockPath })
      try {
        const loaded = await ctx.plugin(AssistantService, { lockPath }).then(() => undefined, (error: unknown) => error)
        if (loaded === undefined) {
          const service = ctx.get('assistants') as AssistantService
          await expect(service.createProfile({ name: 'Blocked', responsibility: 'Work' })).rejects.toThrow(CatalogAlreadyOwnedError)
        } else {
          expect(loaded).toBeInstanceOf(CatalogAlreadyOwnedError)
        }
      } finally {
        await holder.close()
      }
    } finally {
      await ctx.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('activates and opens the catalog when the storage dependency arrives late', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-asst-late-'))
    const ctx = new Context()
    try {
      provideRuntimeStubs(ctx)
      const fiber = ctx.plugin(AssistantService, { lockPath: join(root, 'storages', 'assistants.lock') })
      await Promise.resolve()
      expect(ctx.get('assistants')).toBeUndefined()
      await mountStorage(ctx, root)
      await fiber
      const service = ctx.get('assistants') as AssistantService
      await service.listProfiles()
      expect(service.catalog).toBeDefined()
    } finally {
      await ctx.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('releases the write lease on disposal so a later open succeeds', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-asst-close-'))
    const ctx = new Context()
    const lockPath = join(root, 'storages', 'assistants.lock')
    try {
      provideRuntimeStubs(ctx)
      await mountStorage(ctx, root)
      await ctx.plugin(AssistantService, { lockPath })
      const service = ctx.get('assistants') as AssistantService
      await service.createProfile({ name: 'Persist before close', responsibility: 'Work' })
    } finally {
      await ctx.fiber.dispose()
    }
    const reopened = new Context()
    try {
      provideRuntimeStubs(reopened)
      await mountStorage(reopened, root)
      await reopened.plugin(AssistantService, { lockPath })
      const service = reopened.get('assistants') as AssistantService
      await expect(service.listProfiles()).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Persist before close' })]),
      )
    } finally {
      await reopened.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
