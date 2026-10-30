// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImSettings, type ImSettingsActions } from '../src/client/ImSettings.tsx'
import { en, zh, type ImLocaleKey } from '../src/client/locales.ts'
import type { ImSnapshot, ImChannel, ConnectionConfig } from '../src/schema.ts'

afterEach(cleanup)
function fixture() {
  const row: ImSnapshot = { channel: 'feishu', config: { appId: 'app', tenantId: 'org', chatId: 'chat', senderId: 'person', cwd: '/workspace', provider: 'fixture', model: 'model' }, enabled: false, phase: 'off', error: null, secretConfigured: true }
  const actions: ImSettingsActions = {
    pickDirectory: vi.fn(async () => null),
    list: vi.fn(async () => [row, { ...row, channel: 'dingtalk' }]), providers: vi.fn(async () => ['fixture']), models: vi.fn(async () => ['model']),
    save: vi.fn(async (channel: ImChannel, config: ConnectionConfig) => ({ ...row, channel, config })), test: vi.fn(async () => row),
    setEnabled: vi.fn(async (_channel: ImChannel, enabled: boolean) => ({ ...row, enabled, phase: enabled ? 'connected' : 'off' })),
  }
  return { actions, row }
}
function locale(dictionary: typeof en) { return (key: ImLocaleKey) => dictionary[key] }

describe('desktop IM settings', () => {
  for (const dictionary of [en, zh]) {
    it(`shows both independent channel forms in ${dictionary.nav}`, async () => {
      const { actions } = fixture()
      const { container } = render(<ImSettings actions={actions} t={locale(dictionary)} />)
      await screen.findByRole('heading', { name: dictionary.feishu })
      expect(screen.getByRole('heading', { name: dictionary.dingtalk })).toBeTruthy()
      expect(screen.getAllByLabelText(dictionary.secret)).toHaveLength(2)
      for (const input of container.querySelectorAll<HTMLInputElement>('input[type=password]')) expect(input.value).toBe('')
      expect(actions.setEnabled).not.toHaveBeenCalled()
    })
  }
  it('tests a saved connection and toggles its actual Host action', async () => {
    const { actions } = fixture()
    render(<ImSettings actions={actions} t={locale(en)} />)
    const heading = await screen.findByRole('heading', { name: en.feishu })
    const card = heading.closest('article')!
    fireEvent.click(within(card).getByRole('button', { name: en.test }))
    await waitFor(() =>{  expect(actions.test).toHaveBeenCalledWith('feishu') })
    await waitFor(() =>{  expect(within(card).getByRole('button', { name: en.enable }).hasAttribute('disabled')).toBe(false) })
    fireEvent.click(within(card).getByRole('button', { name: en.enable }))
    await waitFor(() =>{  expect(actions.setEnabled).toHaveBeenCalledWith('feishu', true) })
    expect(await within(card).findByRole('button', { name: en.disable })).toBeTruthy()
  })
  it('retains entered settings after a failed save and never displays raw error diagnostics', async () => {
    const { actions } = fixture()
    vi.mocked(actions.save).mockRejectedValue(new Error('secret-bearing-sdk-response'))
    render(<ImSettings actions={actions} t={locale(en)} />)
    const card = (await screen.findByRole('heading', { name: en.feishu })).closest('article')!
    fireEvent.change(within(card).getByLabelText(en.senderId), { target: { value: 'different-user' } })
    fireEvent.click(within(card).getByRole('button', { name: en.save }))
    expect(await within(card).findByRole('alert')).toBeTruthy()
    expect((within(card).getByLabelText(en.senderId)).value).toBe('different-user')
    expect(screen.queryByText('secret-bearing-sdk-response')).toBeNull()
  })
  it('adopts normalized saved settings so connection testing becomes available after save', async () => {
    const { actions, row } = fixture()
    vi.mocked(actions.save).mockResolvedValue({ ...row, config: { ...row.config!, cwd: '/canonical/workspace' } })
    render(<ImSettings actions={actions} t={locale(en)} />)
    const card = (await screen.findByRole('heading', { name: en.feishu })).closest('article')!
    fireEvent.change(within(card).getByLabelText(en.cwd), { target: { value: '/alias/workspace' } })
    fireEvent.click(within(card).getByRole('button', { name: en.save }))
    await waitFor(() => {
      expect((within(card).getByLabelText(en.cwd)).value).toBe('/canonical/workspace')
      expect(within(card).getByRole('button', { name: en.test }).hasAttribute('disabled')).toBe(false)
    })
  })

  it('uses the existing folder chooser and retains its selected workspace as an unsaved draft', async () => {
    const { actions } = fixture()
    vi.mocked(actions.pickDirectory).mockResolvedValue('/selected/workspace')
    render(<ImSettings actions={actions} t={locale(en)} />)
    const card = (await screen.findByRole('heading', { name: en.feishu })).closest('article')!
    fireEvent.click(within(card).getByRole('button', { name: en.browse }))
    await waitFor(() => { expect((within(card).getByLabelText(en.cwd)).value).toBe('/selected/workspace') })
    expect(actions.save).not.toHaveBeenCalled()
  })

})
