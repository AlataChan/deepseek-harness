/** Permission, stale-ref, and unsupported-platform classification. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isPermissionDenial, isStaleRef, permissionDeniedFromStatus, publishedDescription, statusProbe, StatusPayloadError } from '../src/refusal.ts'
import { startSupervisor } from '../src/supervisor.ts'

describe('desktop-operation refusal', () => {
  it('treats granted and unknown as allowed and every other state as a denial', () => {
    expect(isPermissionDenial('granted')).toBe(false)
    expect(isPermissionDenial('unknown')).toBe(false)
    expect(isPermissionDenial('denied')).toBe(true)
    const allowed = JSON.stringify({
      data: { permissions: { accessibility: { state: 'granted' }, automation: { state: 'unknown' } } },
    })
    const denied = JSON.stringify({ data: { permissions: { screen_recording: { state: 'denied' } } } })
    expect(permissionDeniedFromStatus(allowed)).toBe(false)
    expect(permissionDeniedFromStatus(denied)).toBe(true)
    expect(() => permissionDeniedFromStatus('{}')).toThrow(StatusPayloadError)
    expect(() => permissionDeniedFromStatus(JSON.stringify({ error: 'status failed' }))).toThrow(StatusPayloadError)
    expect(() => permissionDeniedFromStatus(JSON.stringify({ data: { permissions: { screen: {} } } }))).toThrow(StatusPayloadError)
    expect(() => permissionDeniedFromStatus(JSON.stringify({ data: { permissions: {} } }))).toThrow(StatusPayloadError)
    expect(statusProbe(JSON.stringify({ data: null }))).toBe('unavailable')
    expect(statusProbe(JSON.stringify({ data: { other: true } }))).toBe('unavailable')
    expect(() => permissionDeniedFromStatus(JSON.stringify({ data: null }))).toThrow(StatusPayloadError)
    expect(() => permissionDeniedFromStatus(JSON.stringify({ data: 1 }))).toThrow(StatusPayloadError)
  })

  it('propagates a classification failure that is not syntax or payload shape', () => {
    const parse = JSON.parse
    JSON.parse = () => { throw new TypeError('status payload exploded') }
    try {
      expect(() => statusProbe('{"data":1}')).toThrow(TypeError)
    } finally {
      JSON.parse = parse
    }
  })

  it('classifies STALE_REF and does not treat another code as that class', () => {
    expect(isStaleRef({ code: 'STALE_REF' })).toBe(true)
    expect(isStaleRef({ code: 'AMBIGUOUS_TARGET' })).toBe(false)
    expect(isStaleRef({})).toBe(false)
  })

  it('publishes the Chinese status sentence and spawns nothing on an unsupported tuple', async () => {
    expect(publishedDescription({ supported: false, permissionDenied: false, fallback: 'ready' })).toBe('桌面操作仅支持搭载 Apple 芯片的 macOS。')
    expect(publishedDescription({ supported: true, permissionDenied: true, fallback: 'ready' })).toBe('桌面操作无法使用系统尚未授予的权限。本应用不会更改该权限。')
    expect(publishedDescription({ supported: true, permissionDenied: false, fallback: 'ready' })).toBe('ready')
    expect(() => permissionDeniedFromStatus('null')).toThrow(StatusPayloadError)
    const dir = await mkdtemp(join(tmpdir(), 'ad01-refusal-'))
    const run = await startSupervisor({
      platform: 'linux',
      arch: 'arm64',
      home: dir,
      lockPath: join(dir, 'agent-desktop.lock'),
      binary: process.execPath,
      helper: join(dir, 'helper'),
      args: ['-e', 'process.exit(9)'],
      stdio: 'ignore',
    })
    expect(await run.exited).toBe(0)
    expect(run.childPid()).toBeUndefined()
    await rm(dir, { recursive: true })
  })
})
