// @vitest-environment jsdom
/** Tests for the composer predictions General Settings row and toast. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ComponentProps } from 'react'
import {
  PredictionSettingRow,
  PredictionSettingToast,
} from '../src/client/PredictionSettingRow.tsx'
import {
  PredictionSettingPreference,
  type PredictionSettings,
} from '../src/client/prediction-preference.ts'
import { en, NS, zh } from '../src/client/locales.ts'
import { mountAssistantsUi } from '../src/client/mount.ts'

afterEach(cleanup)

function fixture(options: { writable?: boolean; status?: ConfigFormSnapshot<PredictionSettings>['status']; initial?: boolean } = {}) {
  const { writable = true, status = 'ready', initial = false } = options
  const formState = createSnapshotStore<ConfigFormSnapshot<PredictionSettings>>({
    status,
    value: { enableComposerPredictions: initial },
    base: {},
    user: {},
    revision: 0,
    writable,
    mode: 'host',
  })
  const set = vi.fn(async (_field: string, enabled: unknown) => {
    formState.update((state) => {
      state.value = { enableComposerPredictions: enabled === true }
    })
    return true
  })
  const form: ConfigForm<PredictionSettings> = {
    getSnapshot: () => formState.getSnapshot(),
    subscribe: listener => formState.subscribe(listener),
    set,
    unset: vi.fn(),
    mutate: vi.fn(),
  }
  const preference = new PredictionSettingPreference(form)
  const props = {
    useForm: bindSnapshotSelector(formState),
    useMutation: bindSnapshotSelector(preference.state),
    setEnabled: (enabled: boolean) => preference.setEnabled(enabled),
    dismiss: () => { preference.dismiss() },
    t: makeTranslate(zh),
  } as ComponentProps<typeof PredictionSettingRow>
  return { formState, set, preference, props }
}

describe('PredictionSettingRow', () => {
  it('shows a saved preference and keeps its notice after the row unmounts', async () => {
    const { props, set } = fixture({ initial: false })
    const row = render(<PredictionSettingRow {...props} />)
    render(<PredictionSettingToast {...props} />)

    expect(screen.getByText(zh.settingPredictionTitle)).toBeTruthy()
    expect(screen.getByText(zh.settingPredictionDescription)).toBeTruthy()

    const switchEl = screen.getByRole('switch', { name: zh.settingPredictionTitle })
    expect(switchEl.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(switchEl)
    await waitFor(() => {
      expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    })
    expect(set).toHaveBeenCalledWith('enableComposerPredictions', true)

    row.unmount()
    expect(screen.getByText(zh.settingSaved)).toBeTruthy()
  })

  it.each(['refused', 'rejected'] as const)('retains accepted state after a %s write', async (failure) => {
    const { props, set } = fixture({ initial: false })
    if (failure === 'refused') set.mockResolvedValue(false)
    else set.mockRejectedValue(new Error('Network error'))

    render(
      <>
        <PredictionSettingRow {...props} />
        <PredictionSettingToast {...props} />
      </>,
    )

    fireEvent.click(screen.getByRole('switch'))
    await screen.findByText(zh.settingSaveFailed)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  })

  it('disables switch until a pending write settles', async () => {
    const { props, set, preference } = fixture({ initial: false })
    const pending = Promise.withResolvers<boolean>()
    set.mockReturnValue(pending.promise)

    render(<PredictionSettingRow {...props} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(true)

    // Parallel attempt while busy is ignored
    await preference.setEnabled(true)
    expect(set).toHaveBeenCalledTimes(1)

    pending.resolve(true)
    await waitFor(() => {
      expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(false)
    })
  })

  it('cannot edit read-only settings and renders English correctly', async () => {
    const { props, set } = fixture({ writable: false, initial: true })
    render(<PredictionSettingRow {...props} t={makeTranslate(en)} />)

    expect(screen.getByText(en.settingPredictionTitle)).toBeTruthy()
    expect(screen.getByText(en.settingPredictionDescription)).toBeTruthy()

    const switchEl = screen.getByRole('switch', { name: en.settingPredictionTitle })
    expect(switchEl.hasAttribute('disabled')).toBe(true)
    expect(switchEl.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(switchEl)
    expect(set).not.toHaveBeenCalled()
  })

  it('disables switch when form status is not ready', async () => {
    const { props, set } = fixture({ status: 'loading', initial: false })
    render(<PredictionSettingRow {...props} />)

    const switchEl = screen.getByRole('switch')
    expect(switchEl.hasAttribute('disabled')).toBe(true)
    fireEvent.click(switchEl)
    expect(set).not.toHaveBeenCalled()
  })
})

describe('Mount integration for settings.general.item slot', () => {
  it('registers settings.general.item while assistant-registry is served and unregisters on disposal', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SlotRegistry).await()
      ctx.provide('locale', new LocaleRuntime(ctx))
      const describe = vi.fn(async () => ({
        ok: true as const,
        value: {
          writable: true,
          hasDocument: true,
          namespaces: [] as { ns: string; schema: object; value: object; applies: 'live'; secrets: never[]; revision: number }[],
        },
      }))
      const remote = new TestRemote(ctx, { settings: { describe } })
      await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
      const slots = ctx.get('slots') as SlotRegistry
      slots.register(
        {
          name: 'root',
          children: {
            'settings.general.item': { kind: 'list', scope: 'root' },
            'shell.overlay': { kind: 'list', scope: 'root' },
          },
        } as never,
        () => null,
      )

      const cleanup = await mountAssistantsUi(ctx)
      await ctx.configForms.describe().ensure()
      expect(slots.entries('settings.general.item')).toHaveLength(0)

      describe.mockResolvedValue({
        ok: true,
        value: {
          writable: true,
          hasDocument: true,
          namespaces: [
            {
              ns: 'assistant-registry',
              schema: {},
              value: { enableComposerPredictions: false },
              applies: 'live',
              secrets: [],
              revision: 1,
            },
          ],
        },
      })
      remote.emit('settings/document-updated', ['assistant-registry', 1])
      await vi.waitFor(() => {
        expect(slots.entries('settings.general.item').filter(e => e.options.id === 'assistant-registry-predictions')).toHaveLength(1)
      })

      const entry = slots.entries('settings.general.item').find(e => e.options.id === 'assistant-registry-predictions')!
      expect(entry.options).toMatchObject({
        id: 'assistant-registry-predictions',
        order: 85,
      })
      expect(entry.locale).toBe(NS)

      await cleanup()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
