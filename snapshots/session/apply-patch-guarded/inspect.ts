/** One persisted Session record. Nested fields stay narrow at the readers below. */
interface SessionRecord {
  readonly type?: string
  readonly data?: SessionData
}

interface SessionData {
  readonly callId?: string
  readonly meta?: {
    readonly stopped?: boolean
    readonly diffs?: readonly unknown[]
  }
  readonly error?: { readonly code?: string }
  readonly message?: {
    readonly isError?: boolean
    readonly toolCallId?: string
    readonly source?: { readonly callId?: string }
    readonly content?: readonly TextBlock[]
  }
  readonly name?: string
  readonly call?: { readonly name?: string }
}

interface TextBlock {
  readonly type?: string
  readonly text?: string
}

/**
 * Require the authored guarded patch: create, update, delete, and move succeed together,
 * an unread delete and a symlink delete are refused, and a later sandbox denial keeps the
 * earlier write without claiming success. Results count only when their call id is one of
 * the `apply_patch` calls.
 * @param log - persisted Session JSONL for one apply-patch-guarded run.
 * @returns nothing when the parsed events satisfy those outcomes.
 */
export function assertApplyPatchGuarded(log: string): void {
  if (log.includes('"type":"model/selection"')) throw new Error('model/selection is present')
  const events = parseRecords(log)
  const calls = events.filter(event => event.type === 'tool/call' && toolName(event) === 'apply_patch')
  if (calls.length < 4) throw new Error(`expected at least 4 apply_patch calls, saw ${calls.length}`)
  const callIds = new Set(calls.flatMap(event => {
    const id = callId(event)
    return id === undefined ? [] : [id]
  }))
  if (callIds.size !== calls.length) throw new Error('an apply_patch call has no call id')
  const results = events.filter(event => event.type === 'tool/result' && callIds.has(callId(event) ?? ''))
  if (results.length < calls.length) throw new Error('an apply_patch call has no correlated result')
  const success = results.find(event => textOf(event).includes('Success. Updated the following files:')
    && textOf(event).includes('created.txt')
    && textOf(event).includes('notes.txt')
    && textOf(event).includes('gone.txt')
    && textOf(event).includes('move-dst.txt'))
  if (success === undefined) throw new Error('missing successful create, update, delete, and move report')
  if (success.data?.message?.isError === true) throw new Error('successful patch was logged as an error')
  const diffs = success.data?.meta?.diffs
  if (!Array.isArray(diffs) || diffs.length === 0) throw new Error('successful patch has no review diffs')
  if (!results.some(event => event.data?.error?.code === 'FS_NOT_OBSERVED')) {
    throw new Error('missing unread delete refusal')
  }
  if (!results.some(event => event.data?.error?.code === 'PATCH_SYMLINK_SOURCE')) {
    throw new Error('missing symlink refusal')
  }
  const stopped = results.find(event => textOf(event).includes('Patch stopped after') && textOf(event).includes('kept.txt'))
  if (stopped === undefined) throw new Error('missing partial sandbox report')
  if (textOf(stopped).includes('Success.')) throw new Error('partial patch claims success')
  if (stopped.data?.meta?.stopped !== true) throw new Error('partial patch review metadata is not stopped')
  if (textOf(stopped).includes('escape.txt') && textOf(stopped).includes('A ')) {
    const completed = textOf(stopped).split('\n').filter(line => line.startsWith('A '))
    if (completed.some(line => line.includes('escape.txt'))) throw new Error('escaped path was reported as created')
  }
}

function parseRecords(log: string): SessionRecord[] {
  return log.split('\n').flatMap((line) => {
    if (line.trim() === '') return []
    return [JSON.parse(line) as SessionRecord]
  })
}

function toolName(event: SessionRecord): string | undefined {
  return event.data?.name ?? event.data?.call?.name
}

function callId(event: SessionRecord): string | undefined {
  return event.data?.callId ?? event.data?.message?.toolCallId ?? event.data?.message?.source?.callId
}

function textOf(event: SessionRecord): string {
  return (event.data?.message?.content ?? [])
    .flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : [])
    .join('\n')
}
