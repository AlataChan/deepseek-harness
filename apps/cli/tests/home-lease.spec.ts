/** Exclusive companion ownership of one resolved DSH_HOME. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  acquireHomeLease,
  HomeBusyError,
  HOME_LEASE_RELATIVE_PATH,
  type HomeLeaseRecord,
} from '../src/home-lease.ts'

const tmpHome = (): string => mkdtempSync(join(tmpdir(), 'dsh-home-lease-'))

function record(home: string, pid = 41): HomeLeaseRecord {
  return {
    version: 1,
    pid,
    instanceId: 'existing-owner',
    startedAt: '2026-08-19T00:00:00.000Z',
    home,
    surface: 'vscode',
  }
}

describe('the companion home lease', () => {
  it('acquires exclusively and removes only its matching owner record on clean release', () => {
    const home = tmpHome()
    const lease = acquireHomeLease(home, {
      surface: 'vscode',
      pid: 52,
      instanceId: 'new-owner',
      now: () => new Date('2026-08-19T01:00:00.000Z'),
    })
    expect(JSON.parse(readFileSync(lease.path, 'utf8'))).toEqual(lease.owner)
    lease.release()
    expect(existsSync(lease.path)).toBe(false)
    lease.release()
  })

  it('fails closed when another live companion owns the same home', () => {
    const home = tmpHome()
    const first = acquireHomeLease(home, { surface: 'vscode', pid: 60, instanceId: 'first' })
    expect(() => acquireHomeLease(home, {
      surface: 'vscode',
      pid: 61,
      instanceId: 'second',
      probePid: () => 'alive',
    })).toThrow(HomeBusyError)
    expect(readFileSync(first.path, 'utf8')).toContain('first')
    first.release()
  })

  it('fails closed while another contender owns dead-record recovery', () => {
    const home = tmpHome()
    const recoveryPath = join(home, `${HOME_LEASE_RELATIVE_PATH}.recovery`)
    mkdirSync(recoveryPath, { recursive: true })
    expect(() => acquireHomeLease(home, {
      surface: 'vscode',
      pid: 62,
      instanceId: 'contender',
    })).toThrow(HomeBusyError)
    expect(existsSync(join(home, HOME_LEASE_RELATIVE_PATH))).toBe(false)
  })

  it('archives a definitely dead owner and retries exclusive acquisition once', () => {
    const home = tmpHome()
    const lockPath = join(home, HOME_LEASE_RELATIVE_PATH)
    const first = acquireHomeLease(home, { surface: 'vscode', pid: 70, instanceId: 'dead-owner' })
    const previous = readFileSync(first.path, 'utf8')
    const lease = acquireHomeLease(home, {
      surface: 'vscode',
      pid: 71,
      instanceId: 'replacement',
      probePid: () => 'dead',
      now: () => new Date('2026-08-19T02:00:00.000Z'),
    })
    expect(lease.path).toBe(lockPath)
    expect(readFileSync(lockPath, 'utf8')).toContain('replacement')
    const stale = readdirSync(dirname(lockPath)).filter(name => name.startsWith('companion.lock.stale-'))
    expect(stale).toHaveLength(1)
    expect(readFileSync(join(dirname(lockPath), stale[0] as string), 'utf8')).toBe(previous)
    first.release()
    expect(existsSync(lockPath)).toBe(true)
    lease.release()
  })

  it.each([
    { contents: '{', probe: () => 'alive' as const },
    { contents: JSON.stringify({ version: 1, pid: 'bad' }), probe: () => 'alive' as const },
    { contents: undefined, probe: () => 'indeterminate' as const },
  ])('leaves corrupt or indeterminate ownership in place ($contents)', ({ contents, probe }) => {
    const home = tmpHome()
    const initial = acquireHomeLease(home, { surface: 'vscode', pid: 80, instanceId: 'owner' })
    if (contents !== undefined) writeFileSync(initial.path, contents)
    expect(() => acquireHomeLease(home, {
      surface: 'vscode',
      pid: 81,
      instanceId: 'contender',
      probePid: probe,
    })).toThrow(HomeBusyError)
    expect(existsSync(initial.path)).toBe(true)
  })

  it('does not delete a record replaced by another owner before release', () => {
    const home = tmpHome()
    const lease = acquireHomeLease(home, { surface: 'vscode', pid: 90, instanceId: 'original' })
    const replacement = record(home, 91)
    writeFileSync(lease.path, JSON.stringify(replacement) + '\n')
    lease.release()
    expect(JSON.parse(readFileSync(lease.path, 'utf8'))).toEqual(replacement)
  })

  it('refuses a second surface and names the owner', () => {
    const home = tmpHome()
    const first = acquireHomeLease(home, { surface: 'vscode' })
    expect(() => acquireHomeLease(home, { surface: 'desktop' }))
      .toThrow(/home-busy.*vscode/su)
    first.release()
    const second = acquireHomeLease(home, { surface: 'desktop' })
    expect(second).toBeDefined()
    second.release()
  })

  it('writes one shared lock path', () => {
    expect(HOME_LEASE_RELATIVE_PATH).toBe(join('.locks', 'companion.lock'))
  })
})
