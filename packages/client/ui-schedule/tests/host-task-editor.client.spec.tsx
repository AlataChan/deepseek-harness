// @vitest-environment jsdom
/** Manual creation remains inside the existing Automation Tasks page. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { TaskCreate } from '../src/client/TaskDetail.tsx'
import type { TaskCreateProps } from '../src/client/TaskDetail.tsx'
import { en, zh } from '../src/client/task-manager-locales.ts'
import type { ScheduleCatalogEntry, ScheduleId } from '@deepseek-ai/dsh-schedule/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
const task: ScheduleCatalogEntry = {
  id: 'manual' as ScheduleId, kind: 'after', afterSeconds: 60, scheduledAt: '2099-01-01T00:00:00.000Z',
  title: 'Inspect', prompt: 'Inspect the service', target: { kind: 'new_once', sessionId: 'reserved' as SessionId, create: {} },
  involvedSessionIds: ['reserved' as SessionId], status: 'active',
}
afterEach(cleanup)
it.each([en, zh])('creates a default new_once task with localized controls', async (dictionary) => {
  const onCreate = vi.fn<TaskCreateProps['onCreate']>().mockResolvedValue({ ok: true, value: task })
  const onCreated = vi.fn()
  render(<TaskCreate onCreate={onCreate} onCreated={onCreated} onClose={vi.fn()} t={makeTranslate(dictionary)} />)
  fireEvent.change(screen.getByLabelText(dictionary['detail.name']), { target: { value: task.title } })
  fireEvent.change(screen.getByLabelText(dictionary['detail.instruction']), { target: { value: task.prompt } })
  fireEvent.click(screen.getByRole('button', { name: dictionary['manual.create'] }))
  await waitFor(() => { expect(onCreated).toHaveBeenCalledWith(task.id) })
  expect(onCreate).toHaveBeenCalledExactlyOnceWith({ title: task.title, prompt: task.prompt,
    timing: { kind: 'after', after_seconds: 60 }, target: { kind: 'new_once' },
  })
})
it.each(['session', 'new_once', 'new'] as const)('submits the %s destination and retains a failed draft', async (kind) => {
  const onCreate = vi.fn<TaskCreateProps['onCreate']>().mockRejectedValue(new Error('unavailable'))
  render(<TaskCreate onCreate={onCreate} onCreated={vi.fn()} onClose={vi.fn()} t={makeTranslate(en)} />)
  fireEvent.change(screen.getByLabelText(en['detail.name']), { target: { value: task.title } })
  fireEvent.change(screen.getByLabelText(en['detail.instruction']), { target: { value: task.prompt } })
  fireEvent.change(screen.getByLabelText(en['target.kind']), { target: { value: kind } })
  if (kind === 'session') fireEvent.change(screen.getByLabelText(en['target.sessionId']), { target: { value: 'existing' } })
  else fireEvent.change(screen.getByLabelText(en['target.cwd']), { target: { value: '/workspace' } })
  fireEvent.click(screen.getByRole('button', { name: en['manual.create'] }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', en['manual.error'])
  expect(screen.getByLabelText<HTMLInputElement>(en['detail.name']).value).toBe(task.title)
  expect(onCreate.mock.calls[0]?.[0].target).toEqual(kind === 'session'
    ? { kind, sessionId: 'existing' } : { kind, create: { cwd: '/workspace' } })
})

it.each(['after', 'at', 'every', 'daily', 'weekly', 'cron'] as const)('submits manually selected %s timing and destination creation fields', async (kind) => {
  const onCreate = vi.fn<TaskCreateProps['onCreate']>().mockResolvedValue({ ok: true, value: task })
  render(<TaskCreate onCreate={onCreate} onCreated={vi.fn()} onClose={vi.fn()} t={makeTranslate(en)} />)
  fireEvent.change(screen.getByLabelText(en['detail.name']), { target: { value: task.title } })
  fireEvent.change(screen.getByLabelText(en['detail.instruction']), { target: { value: task.prompt } })
  fireEvent.change(screen.getByLabelText(en['manual.timing']), { target: { value: kind } })
  if (kind === 'after' || kind === 'every') {
    fireEvent.change(screen.getByLabelText(en['manual.seconds']), { target: { value: '120' } })
  } else if (kind === 'at') {
    fireEvent.change(screen.getByLabelText(en['manual.instant']), { target: { value: '2099-01-01T10:00:00Z' } })
  } else {
    if (kind !== 'cron') fireEvent.change(screen.getByLabelText(en['timing.time']), { target: { value: '10:30:00' } })
    if (kind === 'weekly') fireEvent.change(screen.getByLabelText(en['manual.weekdays']), { target: { value: '2,4' } })
    if (kind === 'cron') fireEvent.change(screen.getByLabelText(en['rule.cronLabel']), { target: { value: '30 10 * * 2,4' } })
    fireEvent.change(screen.getByLabelText(en['timing.zone']), { target: { value: 'Asia/Shanghai' } })
  }
  const preset = screen.getByLabelText(en['target.preset'])
  fireEvent.change(preset, { target: { value: 'temporary' } })
  fireEvent.change(preset, { target: { value: '' } })
  fireEvent.change(preset, { target: { value: 'standard' } })
  const cwd = screen.getByLabelText(en['target.cwd'])
  fireEvent.change(cwd, { target: { value: '/discard' } })
  fireEvent.change(cwd, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: en['manual.create'] }))
  await waitFor(() => { expect(onCreate).toHaveBeenCalledOnce() })
  const timing = kind === 'after' ? { kind, after_seconds: 120 }
    : kind === 'every' ? { kind, every_seconds: 120 }
      : kind === 'at' ? { kind, at: '2099-01-01T10:00:00Z' }
        : kind === 'daily' ? { kind, daily: { time: '10:30:00', time_zone: 'Asia/Shanghai' } }
          : kind === 'weekly' ? { kind, weekly: { time: '10:30:00', time_zone: 'Asia/Shanghai', weekdays: [2, 4] } }
            : { kind, cron: { expression: '30 10 * * 2,4', time_zone: 'Asia/Shanghai' } }
  expect(onCreate.mock.calls[0]?.[0]).toMatchObject({ timing, target: { kind: 'new_once', create: { agentPreset: 'standard' } } })
})

it('retires an in-flight create response after the manual editor unmounts', async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<TaskCreateProps['onCreate']>>>()
  const onCreate = vi.fn<TaskCreateProps['onCreate']>().mockReturnValue(pending.promise)
  const onCreated = vi.fn()
  const view = render(<TaskCreate onCreate={onCreate} onCreated={onCreated} onClose={vi.fn()} t={makeTranslate(en)} />)
  fireEvent.change(screen.getByLabelText(en['detail.name']), { target: { value: 'Pending' } })
  fireEvent.change(screen.getByLabelText(en['detail.instruction']), { target: { value: 'Pending' } })
  fireEvent.click(screen.getByRole('button', { name: en['manual.create'] }))
  view.unmount()
  pending.resolve({ ok: true, value: task })
  await pending.promise
  expect(onCreated).not.toHaveBeenCalled()
})

it('retains the manual draft on a Remote failure and does not submit twice while pending', async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<TaskCreateProps['onCreate']>>>()
  const onCreate = vi.fn<TaskCreateProps['onCreate']>().mockReturnValue(pending.promise)
  const view = render(<TaskCreate onCreate={onCreate} onCreated={vi.fn()} onClose={vi.fn()} t={makeTranslate(en)} />)
  fireEvent.change(screen.getByLabelText(en['detail.name']), { target: { value: 'Draft' } })
  fireEvent.change(screen.getByLabelText(en['detail.instruction']), { target: { value: 'Inspect' } })
  fireEvent.change(screen.getByLabelText(en['target.cwd']), { target: { value: '/draft-workspace' } })
  const form = view.container.querySelector('form')
  if (form === null) throw new Error('Missing manual form')
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(onCreate).toHaveBeenCalledOnce()
  pending.resolve({ ok: false, error: new RemoteError('gateway/internal', 'Unavailable', {}) })
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', en['manual.error'])
  expect(screen.getByLabelText<HTMLInputElement>(en['target.cwd']).value).toBe('/draft-workspace')
})
it('ignores a rejected manual create after its editor unmounts', async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<TaskCreateProps['onCreate']>>>()
  const onCreate = vi.fn<TaskCreateProps['onCreate']>().mockReturnValue(pending.promise)
  const view = render(<TaskCreate onCreate={onCreate} onCreated={vi.fn()} onClose={vi.fn()} t={makeTranslate(en)} />)
  fireEvent.change(screen.getByLabelText(en['detail.name']), { target: { value: 'Draft' } })
  fireEvent.change(screen.getByLabelText(en['detail.instruction']), { target: { value: 'Inspect' } })
  fireEvent.click(screen.getByRole('button', { name: en['manual.create'] }))
  view.unmount()
  pending.reject(new Error('Disconnected'))
  await expect(pending.promise).rejects.toThrow('Disconnected')
})
