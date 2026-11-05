/** One persisted Session record. Nested fields stay narrow at the readers below. */
interface SessionRecord {
  readonly type?: string
  readonly data?: SessionData
}

interface SessionData {
  readonly callId?: string
  readonly rootCallId?: string
  readonly parentCallId?: string
  readonly name?: string
  readonly isError?: boolean
  readonly error?: { readonly code?: string }
  readonly content?: readonly TextBlock[]
  readonly message?: {
    readonly toolCallId?: string
    readonly source?: { readonly callId?: string }
    readonly content?: readonly TextBlock[]
  }
}

interface TextBlock {
  readonly type?: string
  readonly text?: string
}

/**
 * Require one `run_code` call whose correlated `apply_patch` dispatches create, update,
 * delete, and move, then refuse an unread delete and a symlink delete, then stop after
 * a sandbox denial. Matching text on any other event does not count.
 * @param log - persisted Session JSONL for one apply-patch-guarded-ptc run.
 * @returns nothing when those dispatches are linked to that `run_code` call.
 */
export function assertApplyPatchGuardedPtc(log: string): void {
  if (log.includes('"type":"model/selection"')) throw new Error('model/selection is present')
  const events = parseRecords(log)
  const runs = events.filter(event => event.type === 'tool/call' && event.data?.name === 'run_code')
  if (runs.length !== 1) throw new Error(`expected one run_code call, saw ${runs.length}`)
  const rootId = runs[0]?.data?.callId
  if (rootId === undefined || rootId === '') throw new Error('run_code call has no call id')
  const result = events.find(event => event.type === 'tool/result' && (
    event.data?.message?.toolCallId === rootId || event.data?.message?.source?.callId === rootId
  ))
  if (result === undefined) throw new Error('run_code call has no correlated result')
  const patches = events.filter(event => event.type === 'tool/ptc-dispatch' && event.data?.name === 'apply_patch')
  if (patches.length < 4) throw new Error(`expected at least 4 apply_patch dispatches, saw ${patches.length}`)
  for (const event of patches) {
    if (event.data?.rootCallId !== rootId || event.data?.parentCallId !== rootId) {
      throw new Error('apply_patch dispatch is not linked to the run_code call')
    }
  }
  const success = patches.find(event => event.data?.isError !== true
    && textOf(event).includes('Success. Updated the following files:')
    && textOf(event).includes('created.txt')
    && textOf(event).includes('notes.txt')
    && textOf(event).includes('gone.txt')
    && textOf(event).includes('move-dst.txt'))
  if (success === undefined) throw new Error('missing successful create, update, delete, and move dispatch')
  if (!patches.some(event => event.data?.error?.code === 'FS_NOT_OBSERVED' && textOf(event).includes('file has not been read'))) {
    throw new Error('missing unread delete refusal')
  }
  if (!patches.some(event => event.data?.error?.code === 'PATCH_SYMLINK_SOURCE' && textOf(event).includes('symbolic link'))) {
    throw new Error('missing symlink refusal')
  }
  const stopped = patches.find(event => textOf(event).includes('Patch stopped after') && textOf(event).includes('kept.txt'))
  if (stopped === undefined) throw new Error('missing partial sandbox dispatch')
  if (textOf(stopped).includes('Success.')) throw new Error('partial patch claims success')
  if (textOf(stopped).includes('escape.txt') && textOf(stopped).split('\n').some(line => line.startsWith('A ') && line.includes('escape.txt'))) {
    throw new Error('escaped path was reported as created')
  }
}

function parseRecords(log: string): SessionRecord[] {
  return log.split('\n').flatMap((line) => {
    if (line.trim() === '') return []
    return [JSON.parse(line) as SessionRecord]
  })
}

function textOf(event: SessionRecord): string {
  const blocks = event.data?.content ?? event.data?.message?.content ?? []
  return blocks.flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : []).join('\n')
}
