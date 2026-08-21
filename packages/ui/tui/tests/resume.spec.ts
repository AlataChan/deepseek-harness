import { describe, expect, it, vi } from 'vitest'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import {
  chooseResumeSession,
  loadResumeRows,
  requireResumeSession,
  type ResumeQuery,
} from '../src/driver/resume.ts'

function header(id: string, createdAt: number): SessionHeader {
  return { version: 0, id: SessionId(id), createdAt, cwd: `/workspace/${id}` }
}

describe('resume session rows', () => {
  it('sorts newest first, applies the limit, and reads titles in one batch', async () => {
    const readTitleSnapshots = vi.fn().mockResolvedValue([
      { sessionId: SessionId('new'), status: 'fulfilled', value: { session: header('new', 30), title: { title: 'New title' } } },
      { sessionId: SessionId('mid'), status: 'rejected', reason: new Error('bad title') },
    ])
    const query: ResumeQuery = {
      listSessions: vi.fn().mockResolvedValue([
        { header: header('old', 10), live: false, persisted: true },
        { header: header('new', 30), live: false, persisted: true },
        { header: header('mid', 20), live: false, persisted: true },
      ]),
      readTitleSnapshots,
    }
    const rows = await loadResumeRows(query, 2)
    expect(rows).toEqual([
      expect.objectContaining({ sessionId: 'new', title: 'New title', createdAt: 30 }),
      expect.objectContaining({ sessionId: 'mid', title: 'mid', createdAt: 20 }),
    ])
    expect(readTitleSnapshots).toHaveBeenCalledOnce()
    expect(readTitleSnapshots).toHaveBeenCalledWith([SessionId('new'), SessionId('mid')], undefined)
  })

  it('handles an empty corpus, exact-id misses, cancellation, and collisions', async () => {
    const empty: ResumeQuery = {
      listSessions: () => Promise.resolve([]),
      readTitleSnapshots: () => Promise.resolve([]),
    }
    await expect(loadResumeRows(empty, 5)).resolves.toEqual([])
    await expect(requireResumeSession(empty, SessionId('missing'))).rejects.toThrow(/not found/)
    expect(chooseResumeSession([], undefined)).toBeUndefined()

    const duplicate: ResumeQuery = {
      listSessions: () => Promise.resolve([
        { header: header('same', 1), live: false, persisted: true },
        { header: header('same', 2), live: true, persisted: true },
      ]),
      readTitleSnapshots: () => Promise.resolve([]),
    }
    await expect(loadResumeRows(duplicate, 5)).rejects.toThrow(/collision/)
  })

  it('chooses only a row offered by the closed selector snapshot', () => {
    const rows = [{ sessionId: SessionId('one'), title: 'One', createdAt: 1, cwd: '/one' }]
    expect(chooseResumeSession(rows, SessionId('one'))).toBe(SessionId('one'))
    expect(() => chooseResumeSession(rows, SessionId('other'))).toThrow(/not found/)
  })
})
