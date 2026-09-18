// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { InstitutionSquadView } from '@deepseek-ai/dsh-experimental-agent-team/client'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import {
  InstitutionSquads, parseRoute, squadInitial, type InstitutionSquadsInjected, type InstitutionSquadsProps,
} from '../src/client/InstitutionSquads.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const WORKSPACE = 'ws-1' as WorkspaceId
const LEAD = 'squad-lead' as SessionId

const documentSquad: InstitutionSquadView = {
  id: 'document',
  displayName: '文书组',
  displayNameEn: 'Document squad',
  established: false,
  seats: [
    { name: 'archivist', title: '资料员', titleEn: 'Archivist', duty: 'duty' },
    { name: 'drafter', title: '文书员', titleEn: 'Drafter', duty: 'duty' },
  ],
}

const catalog = {
  default: { provider: 'mock', model: 'mock' },
  routableProviders: ['mock'],
  groups: [{ id: 'mock', name: 'Mock', models: [{ id: 'fast', name: 'Fast' }] }],
  failures: [],
}

function remoteOk<T>(value: T) {
  return Promise.resolve({ ok: true as const, value })
}

function props(overrides: Partial<InstitutionSquadsInjected> & {
  workspaceId?: WorkspaceId
  rows?: InstitutionSquadView[]
} = {}): InstitutionSquadsProps {
  const rows = overrides.rows ?? [documentSquad, {
    ...documentSquad,
    id: 'case' as const,
    displayName: '案例组',
    displayNameEn: 'Case squad',
  }, {
    ...documentSquad,
    id: 'comms' as const,
    displayName: '传播部',
    displayNameEn: 'Comms squad',
  }]
  const injected: InstitutionSquadsInjected = {
    list: overrides.list ?? (() => remoteOk(rows)),
    updateSeat: overrides.updateSeat ?? (request => remoteOk(rows.map(row => (
      row.id === request.squadId
        ? {
          ...row,
          seats: row.seats.map(seat => seat.name === request.name
            ? {
              ...seat,
              ...request.provider === undefined ? {} : { provider: request.provider },
              ...request.model === undefined ? {} : { model: request.model },
            }
            : seat),
        }
        : row
    )))),
    models: overrides.models ?? (() => remoteOk(catalog)),
    createSession: overrides.createSession ?? (() => Promise.resolve(LEAD)),
    renameSession: overrides.renameSession ?? (() => remoteOk({ title: '文书组' })),
    ensure: overrides.ensure ?? (() => remoteOk({
      sessionId: LEAD,
      squadId: 'document' as const,
      members: [],
    })),
    openSession: overrides.openSession ?? vi.fn(),
  }
  return {
    t: makeTranslate(zh),
    ...overrides.workspaceId === undefined && !('workspaceId' in overrides)
      ? { workspaceId: WORKSPACE }
      : overrides.workspaceId === undefined ? {} : { workspaceId: overrides.workspaceId },
    ...injected,
  } as InstitutionSquadsProps
}

describe('InstitutionSquads', () => {
  it('shows the three standing squads and blocks dispatch without a workspace', async () => {
    render(<InstitutionSquads {...props({ workspaceId: undefined })} />)
    await waitFor(() => { expect(screen.getByText('文书组')).toBeTruthy() })
    expect(screen.getByText('案例组')).toBeTruthy()
    expect(screen.getByText('传播部')).toBeTruthy()
    expect(screen.getByText('先选工作区，再派活给常驻小队。')).toBeTruthy()
    expect((screen.getAllByRole('button', { name: '派活给这支队' })[0] as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getAllByRole('button', { name: '派活给这支队' })[0]!)
    fireEvent.click(screen.getByLabelText('文书组'))
  })

  it('creates, titles, ensures, and opens a new standing Lead', async () => {
    const createSession = vi.fn(() => Promise.resolve(LEAD))
    const renameSession = vi.fn(() => remoteOk({ title: '文书组' }))
    const ensure = vi.fn(() => remoteOk({ sessionId: LEAD, squadId: 'document' as const, members: [] }))
    const openSession = vi.fn()
    render(<InstitutionSquads {...props({ createSession, renameSession, ensure, openSession })} />)
    await waitFor(() => { expect(screen.getByLabelText('文书组')).toBeTruthy() })
    fireEvent.click(screen.getByLabelText('文书组'))
    await waitFor(() => { expect(openSession).toHaveBeenCalledWith(LEAD) })
    expect(createSession).toHaveBeenCalledWith(WORKSPACE)
    expect(renameSession).toHaveBeenCalledWith(LEAD, '文书组')
    expect(ensure).toHaveBeenCalledWith(LEAD, { squadId: 'document' })
  })

  it('reuses an established Lead without creating a session', async () => {
    const createSession = vi.fn(() => Promise.resolve('other' as SessionId))
    const openSession = vi.fn()
    const established: InstitutionSquadView = {
      ...documentSquad,
      established: true,
      leadSessionId: LEAD,
    }
    render(<InstitutionSquads {...props({
      rows: [established],
      createSession,
      openSession,
    })} />)
    await waitFor(() => { expect(screen.getByText('已在编')).toBeTruthy() })
    fireEvent.click(screen.getByLabelText('文书组'))
    await waitFor(() => { expect(openSession).toHaveBeenCalledWith(LEAD) })
    expect(createSession).not.toHaveBeenCalled()
  })

  it('writes a seat model into the catalog from the expanded roster', async () => {
    const updateSeat = vi.fn((request: { name: string }) => remoteOk([{
      ...documentSquad,
      seats: documentSquad.seats.map(seat => seat.name === request.name
        ? { ...seat, provider: 'mock', model: 'fast' }
        : seat),
    }]))
    render(<InstitutionSquads {...props({ updateSeat, rows: [documentSquad] })} />)
    await waitFor(() => { expect(screen.getByText('编制座位')).toBeTruthy() })
    fireEvent.click(screen.getByText('编制座位'))
    fireEvent.click(screen.getByText('编制座位'))
    fireEvent.click(screen.getByText('编制座位'))
    const select = screen.getAllByRole('combobox')[0]
    fireEvent.change(select!, { target: { value: 'fast' } })
    fireEvent.change(select!, { target: { value: ':solo' } })
    fireEvent.change(select!, { target: { value: '' } })
    fireEvent.change(select!, { target: { value: 'mock:fast' } })
    await waitFor(() => { expect(updateSeat).toHaveBeenCalledWith({
      squadId: 'document',
      name: 'archivist',
      provider: 'mock',
      model: 'fast',
    }) })
  })

  it('surfaces a list failure and returns ? for an empty avatar', async () => {
    render(<InstitutionSquads {...props({
      list: () => Promise.resolve({
        ok: false as const,
        error: new RemoteError('gateway/internal', 'offline', {}),
      }),
    })} />)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('offline') })
    expect(squadInitial('')).toBe('?')
    expect(squadInitial('文书组')).toBe('文')
    expect(parseRoute('')).toEqual({})
    expect(parseRoute('fast')).toEqual({ model: 'fast' })
    expect(parseRoute(':solo')).toEqual({ model: ':solo' })
    expect(parseRoute('mock:fast')).toEqual({ provider: 'mock', model: 'fast' })
  })

  it('surfaces rename, ensure, create, and seat-update failures', async () => {
    const renameFail = render(<InstitutionSquads {...props({
      renameSession: () => Promise.resolve({
        ok: false as const,
        error: new RemoteError('gateway/internal', 'rename failed', {}),
      }),
    })} />)
    await waitFor(() => { expect(screen.getByLabelText('文书组')).toBeTruthy() })
    fireEvent.click(screen.getByLabelText('文书组'))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('rename failed') })
    renameFail.unmount()

    const ensureFail = render(<InstitutionSquads {...props({
      rows: [{ ...documentSquad, established: true, leadSessionId: LEAD }],
      ensure: () => Promise.resolve({
        ok: false as const,
        error: new RemoteError('gateway/internal', 'ensure failed', {}),
      }),
    })} />)
    await waitFor(() => { expect(screen.getByLabelText('文书组')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '派活给这支队' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('ensure failed') })
    ensureFail.unmount()

    const thrown = render(<InstitutionSquads {...props({
      createSession: () => Promise.reject(new Error('create failed')),
    })} />)
    await waitFor(() => { expect(screen.getByLabelText('文书组')).toBeTruthy() })
    fireEvent.click(screen.getByLabelText('文书组'))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('create failed') })
    thrown.unmount()

    const thrownText = render(<InstitutionSquads {...props({
      createSession: () => Promise.reject('bare-reject'),
    })} />)
    await waitFor(() => { expect(screen.getByLabelText('文书组')).toBeTruthy() })
    fireEvent.click(screen.getByLabelText('文书组'))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('bare-reject') })
    thrownText.unmount()

    const updateFail = render(<InstitutionSquads {...props({
      rows: [documentSquad],
      models: () => Promise.resolve({
        ok: false as const,
        error: new RemoteError('gateway/internal', 'models failed', {}),
      }),
      updateSeat: () => Promise.resolve({
        ok: false as const,
        error: new RemoteError('gateway/internal', 'seat failed', {}),
      }),
    })} />)
    await waitFor(() => { expect(screen.getByText('编制座位')).toBeTruthy() })
    fireEvent.click(screen.getByText('编制座位'))
    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: 'fast' } })
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('seat failed') })
    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: '' } })
    updateFail.unmount()
  })

  it('ignores a second dispatch while the first is in flight', async () => {
    const gate = Promise.withResolvers<SessionId>()
    const createSession = vi.fn(() => gate.promise)
    const openSession = vi.fn()
    render(<InstitutionSquads {...props({ createSession, openSession })} />)
    await waitFor(() => { expect(screen.getByLabelText('文书组')).toBeTruthy() })
    const dispatchButton = screen.getAllByRole('button', { name: '派活给这支队' })[0]!
    fireEvent.click(dispatchButton)
    await waitFor(() => { expect(screen.getByText('正在打开小队…')).toBeTruthy() })
    fireEvent.click(dispatchButton)
    fireEvent.click(screen.getByLabelText('文书组'))
    expect(createSession).toHaveBeenCalledTimes(1)
    gate.resolve(LEAD)
    await waitFor(() => { expect(openSession).toHaveBeenCalledWith(LEAD) })
  })
})
