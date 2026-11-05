import { createHash } from 'node:crypto'

/** One persisted Session record. Nested fields stay narrow at the readers below. */
interface SessionRecord {
  readonly type?: string
  readonly data?: SessionData
}

interface SessionData {
  readonly id?: string
  readonly content?: readonly TextBlock[]
  readonly source?: InstructionSource
  readonly inserted?: readonly SessionData[]
  readonly message?: {
    readonly content?: readonly TextBlock[]
    readonly isError?: boolean
    readonly toolCallId?: string
  }
  readonly error?: { readonly code?: string }
  readonly callId?: string
  readonly name?: string
}

interface TextBlock {
  readonly type?: string
  readonly text?: string
}

interface InstructionChange {
  readonly action?: string
  readonly path?: string
  readonly digest?: string
}

interface InstructionSource {
  readonly kind?: string
  readonly baseline?: boolean
  readonly changes?: readonly InstructionChange[]
}

interface InstructionMessage {
  readonly id: string | undefined
  readonly baseline: boolean
  readonly text: string
  readonly changes: readonly InstructionChange[]
}

const CHAIN_BUDGET_BYTES = 480
const MERGED_BUDGET_BYTES = CHAIN_BUDGET_BYTES * 2
const USER_GLOBAL_PATH = '$DSH_HOME/AGENTS.md'
const PROJECT_PATH = 'AGENTS.md'
const HEADING = /^(?:Updated instructions from|Additional instructions from|Instructions from): (.+)$/u

/**
 * Require both authored instruction chains, their later updates, and the per-chain byte budget.
 * A log that only reaches DONE, or whose writes were refused before a read, does not pass.
 * @param log - persisted Session JSONL for one instruction-chain-budgets run.
 * @returns nothing when the parsed events satisfy the budget.
 */
export function assertInstructionChainBudgets(log: string): void {
  const events = parseRecords(log)
  const messages = instructionMessages(events)
  const baseline = messages.find(message => message.baseline)
  if (baseline === undefined || !hasBothChains(baseline)) {
    throw new Error('missing instruction chain')
  }
  const updates = messages.filter(message => !message.baseline)
  const updateText = updates.map(message => message.text).join('\n')
  if (!updateText.includes('AUTHORED user-global update') || !updateText.includes('AUTHORED project update')) {
    throw new Error('missing instruction update')
  }
  if (events.some(isUnobservedWrite)) throw new Error('tool write error')
  for (const message of [baseline, ...updates]) {
    assertChainAccounting(message.text)
    assertLoggedDigest(message)
  }
  assertModelVisibleAgreement(events, messages)
  assertRequestEcho(events, messages)
}

function parseRecords(log: string): SessionRecord[] {
  return log.split('\n').flatMap((line) => {
    if (line.trim() === '') return []
    return [JSON.parse(line) as SessionRecord]
  })
}

function textOf(blocks: readonly TextBlock[] | undefined): string {
  return (blocks ?? []).flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : []).join('\n')
}

function instructionMessages(events: readonly SessionRecord[]): InstructionMessage[] {
  return events.flatMap((event) => {
    if (event.type !== 'user/message' || event.data?.source?.kind !== 'agent-instructions') return []
    return [{
      id: event.data.id,
      baseline: event.data.source.baseline === true,
      text: textOf(event.data.content),
      changes: event.data.source.changes ?? [],
    }]
  })
}

function hasBothChains(message: InstructionMessage): boolean {
  const paths = new Set(message.changes.map(change => change.path))
  return paths.has(USER_GLOBAL_PATH)
    && paths.has(PROJECT_PATH)
    && message.text.includes(`Instructions from: ${USER_GLOBAL_PATH}`)
    && hasProjectHeading(message.text)
}

function hasProjectHeading(text: string): boolean {
  return text.includes(`Instructions from: ${PROJECT_PATH}\n`)
    || text.includes(`Updated instructions from: ${PROJECT_PATH}\n`)
    || text.includes(`Additional instructions from: ${PROJECT_PATH}\n`)
}

function isUnobservedWrite(event: SessionRecord): boolean {
  if (event.type !== 'tool/result') return false
  if (event.data?.error?.code === 'FS_NOT_OBSERVED') return true
  const text = textOf(event.data?.message?.content)
  return text.includes('FS_NOT_OBSERVED') || text.includes('has not been read')
}

function chainSections(text: string): readonly { path: string; section: string }[] {
  const body = text.replace(/^<system-reminder>\n/u, '').replace(/\n<\/system-reminder>$/u, '')
  const blocks = body.split('\n\n')
  const sections: { path: string; section: string }[] = []
  for (let index = 0; index < blocks.length; index += 1) {
    const heading = HEADING.exec(blocks[index] ?? '')
    const path = heading?.[1]
    if (path === undefined) continue
    const rest: string[] = []
    for (let cursor = index + 1; cursor < blocks.length; cursor += 1) {
      if (HEADING.test(blocks[cursor] ?? '')) break
      rest.push(blocks[cursor] ?? '')
    }
    sections.push({ path, section: [blocks[index], ...rest].join('\n\n') })
  }
  return sections
}

function assertChainAccounting(text: string): void {
  const sections = chainSections(text)
  if (sections.length === 0) throw new Error('missing instruction chain')
  for (const section of sections) {
    const bytes = Buffer.byteLength(section.section, 'utf8')
    if (bytes > CHAIN_BUDGET_BYTES) {
      throw new Error(`instruction chain exceeds ${CHAIN_BUDGET_BYTES} UTF-8 bytes (${bytes})`)
    }
  }
  if (sections.length < 2) return
  const merged = Buffer.byteLength(text, 'utf8')
  if (merged <= CHAIN_BUDGET_BYTES || merged > MERGED_BUDGET_BYTES) {
    throw new Error(`merged instruction frame is ${merged} UTF-8 bytes; expected >${CHAIN_BUDGET_BYTES} and <=${MERGED_BUDGET_BYTES}`)
  }
}

function assertLoggedDigest(message: InstructionMessage): void {
  const sections = chainSections(message.text)
  for (const change of message.changes) {
    if (change.path === undefined || change.digest === undefined) continue
    if (!message.text.includes(change.path)) {
      throw new Error('logged instruction path is absent from model-visible text')
    }
    const section = sections.find(item => item.path === change.path)
    if (section === undefined || !matchesDigest(section.section, change.digest)) {
      throw new Error('model-visible instruction text does not match the logged digest')
    }
  }
}

function matchesDigest(section: string, digest: string): boolean {
  const parts = section.split('\n\n')
  for (let index = 1; index < parts.length; index += 1) {
    const candidate = parts.slice(index).join('\n\n')
    if (createHash('sha1').update(candidate).digest('hex') === digest) return true
  }
  return false
}

function assertModelVisibleAgreement(events: readonly SessionRecord[], messages: readonly InstructionMessage[]): void {
  const spliced = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'agent/inbox/spliced') continue
    for (const inserted of event.data?.inserted ?? []) {
      if (inserted.id === undefined) continue
      spliced.set(inserted.id, textOf(inserted.content))
    }
  }
  // Dynamic updates are delivered through an inbox splice. The baseline is the
  // appended user message, so it has no splice; both frames are checked against
  // the live request echo below.
  let compared = 0
  for (const message of messages) {
    if (message.baseline) continue
    if (message.id === undefined) throw new Error('model-visible instruction update has no logged id')
    const visible = spliced.get(message.id)
    if (visible === undefined) throw new Error('model-visible instruction update has no logged inbox copy')
    if (visible !== message.text) throw new Error('model-visible text differs from the logged instruction message')
    compared += 1
  }
  if (compared === 0) throw new Error('model-visible instruction update was not compared')
}

const INSTRUCTION_FRAME = /^<system-reminder>(?:(?!<\/system-reminder>)[\s\S])*?(?:Updated instructions from:|Instructions from:)(?:(?!<\/system-reminder>)[\s\S])*?<\/system-reminder>$/u

function assertRequestEcho(events: readonly SessionRecord[], messages: readonly InstructionMessage[]): void {
  const echoed = events.flatMap((event) => {
    if (event.type !== 'assistant/message') return []
    return (event.data?.message?.content ?? []).flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : [])
  })
  let compared = 0
  for (const message of messages) {
    const frame = INSTRUCTION_FRAME.exec(message.text)?.[0]
    if (frame === undefined) throw new Error('logged instruction frame is missing')
    if (!echoed.includes(frame)) throw new Error('model request echo does not match the logged instruction frame')
    compared += 1
  }
  if (compared < 2) throw new Error('model request echo was not compared')
}
