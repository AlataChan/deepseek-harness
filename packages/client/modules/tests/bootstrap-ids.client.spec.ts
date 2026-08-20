/** Shared Client surface bootstrap identities and registration facade. */

import { describe, expect, it, vi } from 'vitest'
import {
  CLIENT_MODULES_ID,
  CLIENT_RUNTIME_ID,
  createClientModuleLoaderFacade,
  PARSER_PRELOAD_IDS,
} from '../src/client/bootstrap-ids.ts'
import type { ClientModuleSystem } from '../src/client/system.ts'

describe('Client surface bootstrap identities', () => {
  it('keeps the module-system bundle before the runtime preload', () => {
    expect(PARSER_PRELOAD_IDS).toEqual([CLIENT_MODULES_ID, CLIENT_RUNTIME_ID])
  })
})

describe('Client surface registration facade', () => {
  it('materializes the queued module-system factory and leaves other registrations queued', () => {
    const target = createClientModuleLoaderFacade()
    const created = { marker: 'created' } as unknown as ClientModuleSystem
    const createClientModuleSystem = vi.fn(() => {
      target.mode = 'live'
      return created
    })
    target.load({ id: 'other', factory: () => ({ marker: 'other' }) })
    target.load({
      id: CLIENT_MODULES_ID,
      factory: () => ({ apply: vi.fn(), createClientModuleSystem }),
    })
    const options = { boot: { rev: 'graph', entries: [] }, staticModules: {} }

    expect(target.create(options)).toBe(created)
    expect(target.pendingQueue.map(registration => registration.id)).toEqual(['other'])
    expect(createClientModuleSystem).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ id: CLIENT_MODULES_ID }),
      options,
    )
    expect(() => target.create(options)).toThrow('create called after module-system boot')
  })

  it('requires the module-system preload', () => {
    const target = createClientModuleLoaderFacade()
    expect(() => target.create({ boot: { rev: 'graph', entries: [] }, staticModules: {} }))
      .toThrow(`did not preload ${CLIENT_MODULES_ID}/client.js`)
  })

  it('rejects bootstrap factories that request an external before the module system exists', () => {
    const target = createClientModuleLoaderFacade()
    target.load({
      id: CLIENT_MODULES_ID,
      factory: (require) => {
        require('react')
        return {}
      },
    })
    expect(() => target.create({ boot: { rev: 'graph', entries: [] }, staticModules: {} }))
      .toThrow(`${CLIENT_MODULES_ID}/client.js requested external "react"`)
  })

  it.each([
    null,
    { apply: 'not-a-function', createClientModuleSystem: vi.fn() },
    { apply: vi.fn(), createClientModuleSystem: 'not-a-function' },
  ])('rejects an incomplete bootstrap module face', (exports) => {
    const target = createClientModuleLoaderFacade()
    target.load({ id: CLIENT_MODULES_ID, factory: () => exports as never })
    expect(() => target.create({ boot: { rev: 'graph', entries: [] }, staticModules: {} }))
      .toThrow('did not export the bootstrap module face')
  })
})
