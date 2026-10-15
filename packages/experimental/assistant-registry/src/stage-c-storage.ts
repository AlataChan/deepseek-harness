/** Validated Stage C storage and serialized, fsynced file replacement. */
import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  GroupDiscussionId,
  GroupMessageId,
  GroupRoundId,
  RoundSlotId,
  TeamDefinitionId,
  TeamSeatId,
  type AuxiliaryUsageRecord,
  type GroupDiscussion,
  type GroupRoundJournalEntry,
  type GroupTranscriptMessage,
  type ReadCursorRecord,
  type RoundSlotJournalEntry,
} from './types.ts'

/** Serializes durable operations; a failed operation does not poison later operations. */
export class StageCStorageQueue {
  private tail: Promise<void> = Promise.resolve()
  /**
   * Execute an operation after earlier durable operations settle.
   * @param operation - operation holding exclusive access.
   * @returns the operation result.
   */
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.then(
      () => {},
      () => {},
    )
    return result
  }
}

/** A replacement reached the destination, but its final durability could not be confirmed. */
export class StageCStorageCommitError extends Error {
  /**
   * Record a failure after destination replacement.
   * @param cause - failure after the destination was replaced.
   */
  constructor(cause: unknown) {
    super('Stage C file replacement completed but durability is uncertain; reload before further writes', { cause })
    this.name = 'StageCStorageCommitError'
  }
}

/**
 * Replace a JSON file after its owner-only temporary file has reached disk.
 * @param storagePath - destination file owned by the profile's single-writer lease.
 * @param value - serializable validated state.
 * @returns completion after file synchronization and replacement; POSIX directories also synchronize.
 */
export async function atomicStageCWrite(storagePath: string, value: unknown): Promise<void> {
  const parent = dirname(storagePath)
  await mkdir(parent, { recursive: true })
  const tmpPath = `${storagePath}.${randomUUID()}.tmp`
  let replaced = false
  try {
    const file = await open(tmpPath, 'wx', 0o600)
    try {
      await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(tmpPath, storagePath)
    replaced = true
    // Windows does not expose directory handles through the Node file API.
    if (process.platform !== 'win32') {
      const directory = await open(parent, 'r')
      try {
        await directory.sync()
      } finally {
        await directory.close()
      }
    }
  } catch (error) {
    if (replaced) throw new StageCStorageCommitError(error)
    throw error
  } finally {
    await unlink(tmpPath).catch((error) => {
      if (!isMissingFile(error)) {
        if (replaced) throw new StageCStorageCommitError(error)
        throw error
      }
    })
  }
}

/**
 * Recognize an absent file without suppressing other storage failures.
 * @param error - filesystem error.
 * @returns whether the file is absent.
 */
export function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Stage C storage object')
  return value as Record<string, unknown>
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid Stage C storage array')
  return value
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid Stage C storage text')
  return value
}
function id(value: unknown): string {
  const result = text(value)
  if (!result) throw new Error('Invalid Stage C storage identifier')
  return result
}
function count(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error('Invalid Stage C storage integer')
  return value
}
function optionalText(value: unknown): string | undefined {
  return value === undefined ? undefined : text(value)
}
function optionalCount(value: unknown): number | undefined {
  return value === undefined ? undefined : count(value)
}
function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error('Invalid Stage C storage boolean')
  return value
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  for (const allowed of choices) if (value === allowed) return allowed
  throw new Error('Invalid Stage C storage status')
}
function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw new Error('Duplicate Stage C storage identity')
}

/**
 * Validate cursor identities and nonnegative durable sequence values.
 * @param value - decoded JSON.
 * @returns completely validated cursor records.
 */
export function parseReadCursors(value: unknown): ReadCursorRecord[] {
  const result = list(value).map((item) => {
    const record = object(item)
    return {
      conversationId: id(record.conversationId),
      lastReadSeq: count(record.lastReadSeq),
      readAt: count(record.readAt),
      windowId: optionalText(record.windowId),
    }
  })
  unique(result.map(record => record.conversationId))
  return result
}

/**
 * Validate billing identities, attribution and consistent token totals.
 * @param value - decoded JSON.
 * @returns validated auxiliary billing records.
 */
export function parseAuxiliaryUsage(value: unknown): AuxiliaryUsageRecord[] {
  const result = list(value).map((item) => {
    const record = object(item)
    const usage = object(record.usage)
    const inputTokens = count(usage.inputTokens)
    const outputTokens = count(usage.outputTokens)
    const totalTokens = count(usage.totalTokens)
    if (totalTokens !== inputTokens + outputTokens) throw new Error('Inconsistent auxiliary token usage')
    return {
      id: id(record.id),
      sessionId: SessionId(id(record.sessionId)),
      seq: count(record.seq),
      provider: id(record.provider),
      model: id(record.model),
      usage: { inputTokens, outputTokens, totalTokens },
      purpose: choice(record.purpose, ['title', 'memory_review', 'prediction', 'summary', 'auxiliary'] as const),
      timestamp: count(record.timestamp),
    }
  })
  unique(result.map(record => record.id))
  return result
}

function parseSlot(value: unknown): RoundSlotJournalEntry {
  const record = object(value)
  let committedReply: RoundSlotJournalEntry['committedReply']
  if (record.committedReply !== undefined) {
    const reply = object(record.committedReply)
    committedReply = {
      text: text(reply.text),
      sourceSessionId: SessionId(id(reply.sourceSessionId)),
      sourceEventSeq: count(reply.sourceEventSeq),
    }
  }
  return {
    slotId: RoundSlotId(id(record.slotId)),
    roundId: GroupRoundId(id(record.roundId)),
    slotIndex: count(record.slotIndex),
    seatId: TeamSeatId(id(record.seatId)),
    seatName: id(record.seatName),
    seatRole: choice(record.seatRole, ['coordinator', 'teammate'] as const),
    sessionId: SessionId(id(record.sessionId)),
    attemptId: id(record.attemptId),
    status: choice(record.status, ['pending', 'active', 'completed', 'cancelled', 'timed_out', 'failed', 'uncertain', 'silent'] as const),
    committedCursor: count(record.committedCursor),
    startedAt: optionalCount(record.startedAt),
    completedAt: optionalCount(record.completedAt),
    tokensUsed: count(record.tokensUsed),
    committedReply,
    resultMessageId: record.resultMessageId === undefined ? undefined : GroupMessageId(id(record.resultMessageId)),
    error: optionalText(record.error),
    executionUncertain: optionalBoolean(record.executionUncertain),
    uncertainExplanation: optionalText(record.uncertainExplanation),
  }
}

/** Complete validated journal state; no partial state is returned on corruption. */
export interface ValidatedRoundJournal {
  readonly discussions: GroupDiscussion[]
  readonly rounds: GroupRoundJournalEntry[]
  readonly transcripts: [GroupDiscussionId, GroupTranscriptMessage[]][]
}

/**
 * Validate complete journal entities, accounting and cross-record references.
 * @param value - decoded JSON journal.
 * @returns validated entities with consistent references.
 */
export function parseRoundJournal(value: unknown): ValidatedRoundJournal {
  const root = object(value)
  const discussions = list(root.discussions).map((item) => {
    const record = object(item)
    return {
      id: GroupDiscussionId(id(record.id)),
      teamId: TeamDefinitionId(id(record.teamId)),
      rootSessionId: record.rootSessionId === undefined ? undefined : SessionId(id(record.rootSessionId)),
      title: optionalText(record.title),
      activeRoundId: record.activeRoundId === undefined ? undefined : GroupRoundId(id(record.activeRoundId)),
      createdAt: count(record.createdAt),
      updatedAt: count(record.updatedAt),
    }
  })
  const rounds = list(root.rounds).map((item) => {
    const record = object(item)
    const bounds = object(record.bounds)
    const slots = list(record.slots).map(parseSlot)
    const round: GroupRoundJournalEntry = {
      id: GroupRoundId(id(record.id)),
      discussionId: GroupDiscussionId(id(record.discussionId)),
      teamId: TeamDefinitionId(id(record.teamId)),
      status: choice(record.status, ['pending', 'active', 'completed', 'cancelled', 'failed'] as const),
      prompt: text(record.prompt),
      recipients: record.recipients === undefined ? undefined : list(record.recipients).map(value => TeamSeatId(id(value))),
      slots,
      activeSlotIndex: count(record.activeSlotIndex),
      totalTokensUsed: count(record.totalTokensUsed),
      handoffCount: count(record.handoffCount),
      bounds: {
        maxSeatsPerRound: count(bounds.maxSeatsPerRound, 1),
        maxHandoffsPerRound: count(bounds.maxHandoffsPerRound),
        maxTokensPerRound: count(bounds.maxTokensPerRound, 1),
        slotTimeoutMs: count(bounds.slotTimeoutMs, 1),
      },
      createdAt: count(record.createdAt),
      startedAt: optionalCount(record.startedAt),
      completedAt: optionalCount(record.completedAt),
      error: optionalText(record.error),
    }
    unique(slots.map(slot => slot.slotId))
    if (slots.some((slot, index) => slot.roundId !== round.id || slot.slotIndex !== index)) throw new Error('Invalid journal slot identity')
    if (round.activeSlotIndex > slots.length || round.totalTokensUsed !== slots.reduce((total, slot) => total + slot.tokensUsed, 0))
      throw new Error('Inconsistent round accounting')
    if (slots.length > round.bounds.maxSeatsPerRound || round.handoffCount > round.bounds.maxHandoffsPerRound)
      throw new Error('Round exceeds durable scheduling bounds')
    if (round.recipients) unique(round.recipients)
    if (round.status === 'completed' && slots.some(slot => slot.status === 'pending' || slot.status === 'active'))
      throw new Error('Completed round has unfinished slots')
    if (round.status === 'pending' && slots.some(slot => slot.status !== 'pending')) throw new Error('Pending round has executed slots')
    return round
  })
  unique(discussions.map(discussion => discussion.id))
  unique(rounds.map(round => round.id))
  const discussionMap = new Map(discussions.map(discussion => [discussion.id, discussion]))
  const roundMap = new Map(rounds.map(round => [round.id, round]))
  for (const round of rounds) {
    if (discussionMap.get(round.discussionId)?.teamId !== round.teamId) throw new Error('Round references absent or mismatched discussion')
  }
  for (const discussion of discussions) {
    if (discussion.activeRoundId !== undefined && roundMap.get(discussion.activeRoundId)?.discussionId !== discussion.id)
      throw new Error('Discussion references absent round')
  }
  const messageIds: string[] = []
  const postingKeys: string[] = []
  const transcripts: [GroupDiscussionId, GroupTranscriptMessage[]][] = list(root.transcripts).map((item) => {
    const pair = list(item)
    if (pair.length !== 2) throw new Error('Invalid transcript tuple')
    const discussionId = GroupDiscussionId(id(pair[0]))
    if (!discussionMap.has(discussionId)) throw new Error('Transcript references absent discussion')
    const messages = list(pair[1]).map((item) => {
      const record = object(item)
      const message: GroupTranscriptMessage = {
        id: GroupMessageId(id(record.id)),
        discussionId: GroupDiscussionId(id(record.discussionId)),
        roundId: GroupRoundId(id(record.roundId)),
        slotId: RoundSlotId(id(record.slotId)),
        authorSeatId: TeamSeatId(id(record.authorSeatId)),
        authorName: id(record.authorName),
        authorRole: optionalText(record.authorRole),
        text: text(record.text),
        sourceSessionId: SessionId(id(record.sourceSessionId)),
        sourceEventSeq: count(record.sourceEventSeq),
        createdAt: count(record.createdAt),
        executionUncertain: optionalBoolean(record.executionUncertain),
      }
      const round = roundMap.get(message.roundId)
      const slot = round?.slots.find(slot => slot.slotId === message.slotId)
      if (
        message.discussionId !== discussionId ||
        round?.discussionId !== discussionId ||
        slot?.seatId !== message.authorSeatId ||
        slot.sessionId !== message.sourceSessionId
      )
        throw new Error('Inconsistent transcript attribution')
      if (
        slot.committedReply &&
        (slot.committedReply.text !== message.text ||
          slot.committedReply.sourceSessionId !== message.sourceSessionId ||
          slot.committedReply.sourceEventSeq !== message.sourceEventSeq)
      )
        throw new Error('Transcript has no matching committed reply')
      messageIds.push(message.id)
      postingKeys.push(`${message.roundId}:${message.slotId}`)
      return message
    })
    return [discussionId, messages]
  })
  unique(transcripts.map(([discussionId]) => discussionId))
  unique(messageIds)
  unique(postingKeys)
  for (const round of rounds)
    for (const slot of round.slots) {
      if (
        slot.resultMessageId !== undefined &&
        !transcripts.some(([, messages]) =>
          messages.some(message => message.id === slot.resultMessageId && message.slotId === slot.slotId && message.roundId === round.id),
        )
      )
        throw new Error('Slot references absent public message')
    }
  return { discussions, rounds, transcripts }
}
