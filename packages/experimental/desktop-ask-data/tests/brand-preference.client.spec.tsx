/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createBrandPreference } from '../src/client/brand-preference.ts'
import { BrandSettingsRow } from '../src/client/BrandSettingsRow.tsx'
import { OctopusMark } from '../src/client/OctopusMark.tsx'
import { BRAND_MARKS } from '../src/client/brand-marks.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import type { BrandSettings, BrandMarkId } from '../src/brand-settings.ts'

afterEach(cleanup)
function fixture(initial: BrandMarkId = 'original') {
  let value: ConfigFormSnapshot<BrandSettings> = { status: 'ready', value: { brandMark: initial }, base: {}, user: {}, revision: 1, writable: true, mode: 'host' }
  const listeners = new Set<() => void>()
  const adopt = (id: BrandMarkId) => {
    value = { ...value, value: { brandMark: id }, revision: (value.revision ?? 0) + 1 }
    listeners.forEach(fn => fn())
  }
  const set = vi.fn(async (_field: string, id: unknown) => { if (id === 'original' || id === 'abstract' || id === 'cartoon') adopt(id); return true })
  const form: ConfigForm<BrandSettings> = {
    getSnapshot: () => value,
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    set, unset: async () => true, mutate: async () => true,
  }
  return { form, set, adopt, listeners }
}

it('updates both mounted marks only after acceptance and restores the durable choice on remount', async () => {
  const f = fixture()
  const preference = createBrandPreference(f.form)
  const view = render(<>
    <OctopusMark size={24} preference={preference} />
    <OctopusMark size={48} preference={preference} />
    <BrandSettingsRow preference={preference} t={makeTranslate(zh)} />
  </>)
  const marks = () => [...view.container.querySelectorAll('img[data-brand-mark]')].slice(0, 2)
  expect(marks().map(img => img.getAttribute('src'))).toEqual([BRAND_MARKS.original, BRAND_MARKS.original])
  fireEvent.click(view.getByRole('button', { name: '抽象款' }))
  await waitFor(() => expect(f.set).toHaveBeenCalledWith('brandMark', 'abstract'))
  await waitFor(() => expect(marks().every(img => img.getAttribute('src') === BRAND_MARKS.abstract)).toBe(true))
  const reopened = createBrandPreference(f.form)
  expect(reopened.getSnapshot().id).toBe('abstract')
  reopened.dispose()
  act(() => f.adopt('cartoon'))
  expect(marks().every(img => img.getAttribute('src') === BRAND_MARKS.cartoon)).toBe(true)
  fireEvent.click(view.getByRole('button', { name: '恢复默认' }))
  await waitFor(() => expect(preference.getSnapshot().id).toBe('original'))
  view.unmount()
  preference.dispose()
  expect(f.listeners.size).toBe(0)
})

it.each(['refused', 'rejected'])('keeps the accepted identity when a write is %s', async (failure) => {
  const f = fixture('cartoon')
  if (failure === 'refused') f.set.mockResolvedValue(false)
  else f.set.mockRejectedValue(new Error('offline'))
  const preference = createBrandPreference(f.form)
  await preference.select('abstract')
  expect(preference.getSnapshot().id).toBe('cartoon')
  expect(preference.getSnapshot().pending).toBe(false)
  expect(preference.getSnapshot().notice?.success).toBe(false)
  preference.dispose()
})

it('does not offer writes before settings are available', async () => {
  const f = fixture()
  const snapshot = { ...f.form.getSnapshot(), status: 'loading' as const, value: undefined }
  f.form.getSnapshot = () => snapshot
  const preference = createBrandPreference(f.form)
  const view = render(<BrandSettingsRow preference={preference} t={makeTranslate(zh)} />)
  expect(view.getByRole('button', { name: '抽象款' }).hasAttribute('disabled')).toBe(true)
  await preference.select('abstract')
  expect(f.set).not.toHaveBeenCalled()
  preference.dispose()
})

it('serializes user choices and suppresses late notices after disposal', async () => {
  const f = fixture()
  let finish: (value: boolean) => void = () => {}
  f.set.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve }))
  const preference = createBrandPreference(f.form)
  const saving = preference.select('abstract')
  await preference.select('cartoon')
  expect(f.set).toHaveBeenCalledTimes(1)
  const listener = vi.fn()
  const unsubscribe = preference.subscribe(listener)
  preference.dispose()
  finish(true)
  await saving
  expect(listener).not.toHaveBeenCalled()
  unsubscribe()
})
