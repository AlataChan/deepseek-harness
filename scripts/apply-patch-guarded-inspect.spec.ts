/**
 * Negative controls for the authored apply_patch inspectors.
 * They read the committed Session logs and reject copies whose correlated events were removed,
 * renamed, or corrupted. A success sentence left on an unrelated result does not pass.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertApplyPatchGuarded } from '../snapshots/session/apply-patch-guarded/inspect.ts'
import { assertApplyPatchGuardedPtc } from '../snapshots/session/apply-patch-guarded-ptc/inspect.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const nativeLog = readFileSync(join(root, 'snapshots/session/apply-patch-guarded/session.v4.jsonl'), 'utf8')
const ptcLog = readFileSync(join(root, 'snapshots/session/apply-patch-guarded-ptc/session.v4.jsonl'), 'utf8')

describe('apply_patch session inspectors', () => {
  it('accepts the committed native and PTC logs', () => {
    assertApplyPatchGuarded(nativeLog)
    assertApplyPatchGuardedPtc(ptcLog)
  })

  it('rejects a native success sentence that is no longer on its apply_patch result', () => {
    const detached = nativeLog.replace('"toolCallId":"call_patch_success"', '"toolCallId":"call_read_0"')
    expect(() => {
      assertApplyPatchGuarded(detached)
    }).toThrow(/correlated result/)
    const renamed = nativeLog.replaceAll('"name":"apply_patch"', '"name":"read"')
    expect(() => {
      assertApplyPatchGuarded(renamed)
    }).toThrow(/apply_patch calls/)
    const corrupted = nativeLog.replace('"code":"PATCH_SYMLINK_SOURCE"', '"code":"FS_IO_ERROR"')
    expect(() => {
      assertApplyPatchGuarded(corrupted)
    }).toThrow(/symlink refusal/)
  })

  it('rejects a PTC log whose apply_patch dispatches were removed, renamed, or unlinked', () => {
    const removed = ptcLog.split('\n').filter(line => !(line.includes('"type":"tool/ptc-dispatch"') && line.includes('"name":"apply_patch"'))).join('\n')
    expect(() => {
      assertApplyPatchGuardedPtc(removed)
    }).toThrow(/apply_patch dispatches/)
    const renamed = ptcLog.replaceAll('"name":"apply_patch"', '"name":"write"')
    expect(() => {
      assertApplyPatchGuardedPtc(renamed)
    }).toThrow(/apply_patch dispatches/)
    const unlinked = ptcLog.replaceAll('"rootCallId":"call_patch_ptc"', '"rootCallId":"other"')
    expect(() => {
      assertApplyPatchGuardedPtc(unlinked)
    }).toThrow(/not linked/)
    const corrupted = ptcLog.replace('Success. Updated the following files:', 'Success. No operations in patch.')
    expect(() => {
      assertApplyPatchGuardedPtc(corrupted)
    }).toThrow(/successful create/)
  })
})
