/**
 * Typed test fixtures for TUI unit and integration suites.
 * Eliminates forbidden `as unknown as` assertions in tests.
 */

import { PassThrough } from 'node:stream'
import {
  Session,
  SessionId,
  type SessionEvent,
  type SessionEventType,
  type SessionEventMap,
} from '@deepseek-ai/dsh-session'
import type {
  Agent,
  AgentCancelCause,
  AgentOptions,
  AgentStatus,
  CancelOptions,
  Inbox,
  InboxTarget,
} from '@deepseek-ai/dsh-agent'
import type { MessageId, UserMessage } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import type { TerminalWriteStream } from '../src/render.ts'
import type { TerminalReadStream } from '../src/input.ts'

/**
 * Concrete stream implementing TerminalWriteStream for rendering tests.
 */
export class TestWriteStream extends PassThrough implements TerminalWriteStream {
  readonly isTTY = true
  columns = 80
  rows = 24
  captured = ''

  constructor(options?: { columns?: number; rows?: number }) {
    super()
    if (options?.columns !== undefined) this.columns = options.columns
    if (options?.rows !== undefined) this.rows = options.rows
    this.on('data', (chunk: Buffer | string) => {
      this.captured += typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
    })
  }

  getColorDepth(): number {
    return 24
  }

  cursorTo(): boolean {
    return true
  }

  moveCursor(): boolean {
    return true
  }

  clearLine(): boolean {
    return true
  }

  clearScreenDown(): boolean {
    return true
  }

  getWindowSize(): [number, number] {
    return [this.columns, this.rows]
  }
}

/**
 * Concrete stream implementing TerminalReadStream for terminal input tests.
 */
export class TestReadStream extends PassThrough implements TerminalReadStream {
  readonly isTTY = true
  isRaw = false

  setRawMode(mode: boolean): this {
    this.isRaw = mode
    return this
  }
}

/**
 * In-memory test inbox conforming to Agent Inbox interface.
 */
export function createTestInbox(): Inbox {
  const nextTurnList: UserMessage[] = []
  const nextStepList: UserMessage[] = []
  return {
    get nextTurn(): readonly UserMessage[] {
      return nextTurnList
    },
    get nextStep(): readonly UserMessage[] {
      return nextStepList
    },
    clear(): void {
      nextStepList.length = 0
      nextTurnList.length = 0
    },
    append(target: InboxTarget, message: UserMessage): void {
      if (target === 'next-turn') nextTurnList.push(message)
      else nextStepList.push(message)
    },
    prepend(target: InboxTarget, message: UserMessage): void {
      if (target === 'next-turn') nextTurnList.unshift(message)
      else nextStepList.unshift(message)
    },
    replace(messageId: MessageId, newMessage: UserMessage): boolean {
      for (const list of [nextTurnList, nextStepList]) {
        const idx = list.findIndex(m => m.id === messageId)
        if (idx !== -1) {
          list[idx] = newMessage
          return true
        }
      }
      return false
    },
    remove(messageId: MessageId): boolean {
      for (const list of [nextTurnList, nextStepList]) {
        const idx = list.findIndex(m => m.id === messageId)
        if (idx !== -1) {
          list.splice(idx, 1)
          return true
        }
      }
      return false
    },
    splice(target: InboxTarget, start: number, deleteCount: number, inserted: UserMessage[]): UserMessage[] {
      const list = target === 'next-turn' ? nextTurnList : nextStepList
      return list.splice(start, deleteCount, ...inserted)
    },
  }
}

/**
 * Construct a real Session fixture.
 * @param id - Session identifier string.
 * @param seed - Optional initial seed events.
 * @returns Real Session instance.
 */
export function createTestSession(id = 'test-session', seed?: readonly SessionEvent[]): Session {
  return Session.create(SessionId(id), seed)
}

/**
 * Options to customize a test agent fixture.
 */
export interface TestAgentOptions {
  id?: string
  session?: Session
  status?: AgentStatus
  options?: AgentOptions
  ctx?: Context
  followup?: (msg: UserMessage) => void
  cancel?: (cause: AgentCancelCause, options?: CancelOptions) => void
  send?: (message: UserMessage, target: InboxTarget, wakeup: boolean) => void
  steer?: (message: UserMessage) => void
  inject?: (message: UserMessage) => void
  whenIdle?: () => Promise<void>
  runMaintenance?: <T>(task: (signal: AbortSignal) => Promise<T>) => Promise<T>
}

/**
 * Construct a fully typed Agent instance for tests without unsafe type assertions.
 * @param options - Custom agent behaviors and properties.
 * @returns Conforming Agent instance.
 */
export function createTestAgent(options: TestAgentOptions = {}): Agent {
  const id = SessionId(options.id ?? 'test-agent')
  const session = options.session ?? createTestSession(options.id ?? 'test-agent')
  const ctx = options.ctx ?? new Context()
  let currentStatus: AgentStatus = options.status ?? 'idle'
  const inbox = createTestInbox()

  const agent: Agent = {
    id,
    session,
    inbox,
    options: options.options ?? { model: 'mock-model' },
    get status(): AgentStatus {
      return currentStatus
    },
    set status(val: AgentStatus) {
      currentStatus = val
    },
    ctx,
    cancel(cause: AgentCancelCause, opts?: CancelOptions): void {
      if (opts !== undefined) {
        options.cancel?.(cause, opts)
      } else {
        options.cancel?.(cause)
      }
    },
    whenIdle(): Promise<void> {
      return options.whenIdle ? options.whenIdle() : Promise.resolve()
    },
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      return options.runMaintenance ? options.runMaintenance(task) : task(new AbortController().signal)
    },
    send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
      options.send?.(message, target, wakeup)
    },
    followup(message: UserMessage): void {
      if (options.followup) options.followup(message)
      else inbox.append('next-turn', message)
    },
    steer(message: UserMessage): void {
      if (options.steer) options.steer(message)
      else inbox.append('next-step', message)
    },
    inject(message: UserMessage): void {
      if (options.inject) options.inject(message)
      else inbox.append('next-step', message)
    },
  }

  return agent
}

/**
 * Create a typed, real SessionEvent using a real detached Session.
 * @param type - Event type discriminator.
 * @param data - Associated event data matching SessionEventMap.
 * @param seq - Optional sequence number.
 * @returns Real typed SessionEvent instance.
 */
export function createTestEvent<K extends SessionEventType>(
  type: K,
  data: SessionEventMap[K],
  seq = 0,
): SessionEvent<K> {
  const session = Session.create(SessionId(`temp-event-session-${String(seq)}`))
  if (
    type === 'user/message'
    || type === 'assistant/message'
    || type === 'system/message'
    || type === 'tool/result'
    || type === 'developer/message'
  ) {
    return (session.append as (t: string, d: unknown, o: unknown) => SessionEvent)(type, data, { surfaceOp: 'append' }) as SessionEvent<K>
  }
  return (session.append as (t: string, d: unknown) => SessionEvent)(type, data) as SessionEvent<K>
}
