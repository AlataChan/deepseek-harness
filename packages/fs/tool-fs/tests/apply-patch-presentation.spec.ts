/** Pure apply_patch call and result cards. They must not touch the filesystem. */

import { describe, expect, it } from 'vitest'
import { patchPresentationMeta, renderPatch } from '../src/apply-patch-output.ts'
import { presentPatchCall, presentPatchResult } from '../src/apply-patch-presentation.ts'

function patch(...lines: string[]): string {
  return ['*** Begin Patch', ...lines, '*** End Patch'].join('\n')
}

describe('apply_patch presentation', () => {
  it('previews adds and edits and lists every path, including a deletion and a move', () => {
    const view = presentPatchCall(patch(
      '*** Add File: created.txt',
      '+hello',
      '*** Update File: notes.txt',
      '*** Move to: notes-next.txt',
      '@@',
      '-old',
      '+new',
      '*** Delete File: gone.txt',
    ))
    expect(view).toMatchObject({
      card: 'diff',
      title: 'Apply patch (4 files)',
      locations: [
        { path: 'created.txt' },
        { path: 'notes.txt' },
        { path: 'notes-next.txt' },
        { path: 'gone.txt' },
      ],
    })
    expect(view?.diffs).toEqual([
      { path: 'created.txt', oldText: null, newText: 'hello\n' },
      { path: 'notes.txt', oldText: 'old', newText: 'new' },
    ])
  })

  it('returns no call card for a patch the parser rejects', () => {
    expect(presentPatchCall('this is not a patch')).toBeUndefined()
  })

  it('previews a pure insertion with no old lines', () => {
    const view = presentPatchCall(patch(
      '*** Update File: notes.txt',
      '@@',
      '+added',
    ))
    expect(view?.diffs).toEqual([{ path: 'notes.txt', oldText: null, newText: 'added' }])
  })

  it('titles a stopped commit and keeps an ordinary commit untitled as stopped', () => {
    const diffs = [{ path: 'a.txt', oldText: 'old', newText: 'new' }]
    expect(presentPatchResult({
      isError: false,
      content: [],
      meta: { diffs, stopped: false },
    })).toEqual({ card: 'diff', title: 'Apply patch', diffs })
    expect(presentPatchResult({
      isError: false,
      content: [],
      meta: { diffs, stopped: true },
    })).toEqual({ card: 'diff', title: 'Apply patch (stopped)', diffs })
  })

  it('leaves errors and missing diff metadata to the generic result card', () => {
    expect(presentPatchResult({ isError: true, content: [] })).toBeUndefined()
    expect(presentPatchResult({ isError: false, content: [], meta: {} })).toBeUndefined()
  })

  it('titles an error that still carries applied diffs as stopped', () => {
    const diffs = [{ path: 'created.txt', oldText: null, newText: 'created\n' }]
    expect(presentPatchResult({
      isError: true,
      content: [{ type: 'text', text: 'Error: tool call aborted\nA created.txt' }],
      meta: { diffs, stopped: true },
    })).toEqual({ card: 'diff', title: 'Apply patch (stopped)', diffs })
  })

  it('omits a null change and an operation that recorded no changes', () => {
    const value = {
      phase: 'commit' as const,
      cancelled: false,
      affectedPaths: ['/gone.txt'],
      operations: [{
        index: 0,
        kind: 'delete' as const,
        path: 'gone.txt',
        patchLine: 2,
        status: 'completed' as const,
        changes: [{ path: '/gone.txt', before: null, after: null }],
      }, {
        index: 1,
        kind: 'add' as const,
        path: 'created.txt',
        patchLine: 4,
        status: 'completed' as const,
      }],
    }
    expect(patchPresentationMeta(value)).toEqual({ diffs: [], stopped: false })
    expect(renderPatch({ ...value, operations: [], affectedPaths: [] })).toBe('Success. No operations in patch.')
  })
})
