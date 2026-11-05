// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { TeamView } from '@deepseek-ai/dsh-experimental-agent-team/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TeamTopology, type TeamTopologyCopy } from '../src/client/TeamTopology.tsx'
import { zh } from '../src/client/locales.ts'

const copy: TeamTopologyCopy = {
  title: zh.topology, hint: zh.topologyHint, show: zh.topologyShow, hide: zh.topologyHide,
  empty: zh.topologyEmpty, edgeMessage: zh.topologyEdgeMessage, edgeTask: zh.topologyEdgeTask,
  leadRole: zh.topologyLead, workerRole: zh.topologyWorker, activityTitle: zh.topologyActivity,
  progress: (done, total) => `${done}/${total}`,
  motionReduce: zh.motionReduce, motionFull: zh.motionFull, memberStatus: key => zh[key],
}
const view: TeamView = {
  members: [
    { id: 'lead' as SessionId, name: 'lead', role: 'lead', status: 'inactive', diagnostics: [] },
    { id: 'writer' as SessionId, name: 'writer', role: 'teammate', status: 'running', diagnostics: [] },
  ],
  tasks: [], interactions: [],
}
const message = { id: 'message-1', from: 'lead', to: 'writer', kind: 'message' as const }

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

it('shows current running activity on open without animating historical messages or idle members', () => {
  const { container } = render(<TeamTopology view={{ ...view, interactions: [message] }} copy={copy} />)
  expect(container.querySelector('[data-status="running"]')?.className).toContain('topologyNodeActive')
  expect(container.querySelector('[data-status="inactive"]')?.className).not.toContain('topologyNodeActive')
  expect(container.querySelector('animateMotion')).toBeNull()
  expect(container.querySelector('[data-edge-kind="message"] > path')?.getAttribute('d')).toContain(' C ')
  expect(container.querySelector('[data-edge-kind="message"] > path')?.getAttribute('marker-end')).toContain('-message)')
})

it('keeps new message motion across a normal refresh and clears it at the bounded deadline', () => {
  const { container, rerender } = render(<TeamTopology view={view} copy={copy} />)
  rerender(<TeamTopology view={{ ...view, interactions: [message] }} copy={copy} />)
  expect(container.querySelector('animateMotion')).not.toBeNull()
  act(() => { vi.advanceTimersByTime(1500) })
  rerender(<TeamTopology view={{ ...view, interactions: [{ ...message }] }} copy={copy} />)
  expect(container.querySelector('animateMotion')).not.toBeNull()
  act(() => { vi.advanceTimersByTime(1100) })
  rerender(<TeamTopology view={{ ...view, interactions: [{ ...message }] }} copy={copy} />)
  expect(container.querySelector('animateMotion')).toBeNull()
})

it('reduces motion immediately while retaining the visible running state', () => {
  const { container, rerender, getByRole } = render(<TeamTopology view={view} copy={copy} />)
  rerender(<TeamTopology view={{ ...view, interactions: [message] }} copy={copy} />)
  fireEvent.click(getByRole('button', { name: zh.motionReduce }))
  expect(container.querySelector('animateMotion')).toBeNull()
  expect(container.querySelector('section')?.dataset.reduceMotion).toBe('true')
  expect(container.querySelector('[data-status="running"]')?.className).toContain('topologyNodeActive')
})

it('keeps task dependencies static and releases its message timer when unmounted', () => {
  const { container, rerender, unmount } = render(<TeamTopology view={view} copy={copy} />)
  const baselineTimers = vi.getTimerCount()
  rerender(<TeamTopology view={{ ...view, interactions: [{ ...message, kind: 'task-dep' }] }} copy={copy} />)
  expect(container.querySelector('animateMotion')).toBeNull()
  unmount()
  expect(vi.getTimerCount()).toBe(baselineTimers)
})
