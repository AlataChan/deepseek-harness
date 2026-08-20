/** Exclusive VS Code companion ownership of one resolved DSH_HOME. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  acquireVsCodeHomeLease,
  VsCodeHomeBusyError,
  VSCODE_HOME_LEASE_RELATIVE_PATH,
  type VsCodeHomeLeaseRecord,
} from '../src/vscode-home-lease.ts'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'dsh-vscode-lease-'))

function record(home: string, pid = 41): VsCodeHomeLeaseRecord {
  return {
    version: 1,
    pid,
    instanceId: 'existing-owner',
    startedAt: '2026-08-19T00:00:00.000Z',
    home,
  }
}

describe('VS Code home lease', () => {
  it('acquires exclusively and removes only its matching owner record on clean release', () => {
    const home = tmp()
    const lease = acquireVsCodeHomeLease(home, {
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
    const home = tmp()
    const first = acquireVsCodeHomeLease(home, { pid: 60, instanceId: 'first' })
    expect(() => acquireVsCodeHomeLease(home, {
      pid: 61,
      instanceId: 'second',
      probePid: () => 'alive',
    })).toThrow(VsCodeHomeBusyError)
    expect(readFileSync(first.path, 'utf8')).toContain('first')
    first.release()
  })

  it('fails closed while another contender owns dead-record recovery', () => {
    const home = tmp()
    const recoveryPath = join(home, `${VSCODE_HOME_LEASE_RELATIVE_PATH}.recovery`)
    mkdirSync(recoveryPath, { recursive: true })
    expect(() => acquireVsCodeHomeLease(home, {
      pid: 62,
      instanceId: 'contender',
    })).toThrow(VsCodeHomeBusyError)
    expect(existsSync(join(home, VSCODE_HOME_LEASE_RELATIVE_PATH))).toBe(false)
  })

  it('archives a definitely dead owner and retries exclusive acquisition once', () => {
    const home = tmp()
    const lockPath = join(home, VSCODE_HOME_LEASE_RELATIVE_PATH)
    const first = acquireVsCodeHomeLease(home, { pid: 70, instanceId: 'dead-owner' })
    const previous = readFileSync(first.path, 'utf8')
    const lease = acquireVsCodeHomeLease(home, {
      pid: 71,
      instanceId: 'replacement',
      probePid: () => 'dead',
      now: () => new Date('2026-08-19T02:00:00.000Z'),
    })
    expect(lease.path).toBe(lockPath)
    expect(readFileSync(lockPath, 'utf8')).toContain('replacement')
    const stale = readdirSync(dirname(lockPath)).filter(name => name.startsWith('vscode-companion.lock.stale-'))
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
    const home = tmp()
    const initial = acquireVsCodeHomeLease(home, { pid: 80, instanceId: 'owner' })
    if (contents !== undefined) writeFileSync(initial.path, contents)
    expect(() => acquireVsCodeHomeLease(home, {
      pid: 81,
      instanceId: 'contender',
      probePid: probe,
    })).toThrow(VsCodeHomeBusyError)
    expect(existsSync(initial.path)).toBe(true)
  })

  it('does not delete a record replaced by another owner before release', () => {
    const home = tmp()
    const lease = acquireVsCodeHomeLease(home, { pid: 90, instanceId: 'original' })
    const replacement = record(home, 91)
    writeFileSync(lease.path, JSON.stringify(replacement) + '\n')
    lease.release()
    expect(JSON.parse(readFileSync(lease.path, 'utf8'))).toEqual(replacement)
  })
})
