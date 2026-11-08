/** Invalid checked-in catalog files must fail closed before any backend can be selected. */
import { afterEach, expect, it, vi } from 'vitest'
import rawContract from '../runtime-contract.json' with { type: 'json' }
afterEach(() => {
  vi.doUnmock('../runtime-contract.json')
  vi.resetModules()
})
it('refuses a route when its catalog contains no backend', async () => {
  const fixture = structuredClone(rawContract)
  const action = fixture.channels.find(channel => channel.name === 'v2ex')?.actions.find(action => action.name === 'hot')
  if (!action) throw new Error('Missing fixture route')
  action.backends = []
  vi.doMock('../runtime-contract.json', () => ({ default: fixture }))
  vi.resetModules()
  const { validateRoute } = await import('../src/catalog.ts')
  expect(validateRoute('v2ex', 'hot')).toMatchObject({ ok: false, code: 'UNKNOWN_BACKEND' })
})
it('defaults a catalog without channel settings to no enabled channels', async () => {
  const fixture = structuredClone(rawContract)
  Reflect.deleteProperty(fixture, 'defaultConfiguration')
  Reflect.deleteProperty(fixture, 'managementCommands')
  Reflect.deleteProperty(fixture, 'excludedActions')
  vi.doMock('../runtime-contract.json', () => ({ default: fixture }))
  vi.resetModules()
  const { validateRoute } = await import('../src/catalog.ts')
  expect(validateRoute('v2ex', 'hot', undefined, {})).toMatchObject({ ok: false, code: 'CHANNEL_DISABLED' })
})
