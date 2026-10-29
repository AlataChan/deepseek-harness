/**
 * Versioned NDJSON IPC over Unix domain sockets and inherited systemd socket streams.
 *
 * Implements strict schema validation, frame bounding, stream lifecycle management,
 * and bounded asynchronous teardown for tenant runtime isolation.
 *
 * @module @deepseek-ai/dsh-experimental-im-feishu/ipc
 */

import { createServer, createConnection } from 'node:net'
import type { Server, Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type { Readable, Writable } from 'node:stream'
import { promises as fs } from 'node:fs'
import { verifySystemdTenantSocket } from './socket-authentication.ts'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Branded } from '@deepseek-ai/dsh-brand'
import {
  listInteractionsRequestSchema, listInteractionsResponseSchema,
  answerInteractionRequestSchema, answerInteractionResponseSchema,
  type ListInteractionsRequest, type ListInteractionsResponse, type AnswerInteractionRequest, type AnswerInteractionResponse,
} from './interaction-protocol.ts'


/** Format protocol version for Unix domain socket IPC framing. */
export const IPC_PROTOCOL_VERSION = 1

/** Bounded frame ceiling (1 MiB) to guard memory against malformed or hostile wire lines. */
export const MAX_FRAME_BYTES = 1024 * 1024

/** Default request timeout in milliseconds. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15000

/** Handshake timeout in milliseconds. */
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5000

/** Default connect timeout in milliseconds. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 5000

/** Default shutdown timeout in milliseconds. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000

/** Default maximum pending client requests before backpressure rejection. */
export const DEFAULT_MAX_PENDING_REQUESTS = 64

/** Default maximum active concurrent server operations before rejection. */
export const DEFAULT_MAX_ACTIVE_OPERATIONS = 64

/** Default maximum buffered outgoing bytes before awaiting drain. */
export const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024

// --- Branded IPC Types ---

/** Branded identifier for an IPC message frame. */
export type IpcMessageId = Branded<'IpcMessageId'>

/** Branded identifier for an IPC delivery key. */
export type IpcDeliveryKey = Branded<'IpcDeliveryKey'>

/** Branded identifier for an IPC tenant identifier. */
export type IpcTenantId = Branded<'IpcTenantId'>

/** Branded identifier for an IPC ingress source identifier. */
export type IpcIngressId = Branded<'IpcIngressId'>

/** Branded identifier for an IPC operator identifier. */
export type IpcOperatorId = Branded<'IpcOperatorId'>

/**
 * Brand a raw string as an IpcMessageId.
 *
 * @param value - Raw message ID.
 * @returns Branded IpcMessageId.
 */
export function parseIpcMessageId(value: string): IpcMessageId {
  if (value.trim() === '') throw new TypeError('IpcMessageId cannot be empty')
  return brandString<IpcMessageId>(value)
}

/**
 * Brand a raw string as an IpcDeliveryKey.
 *
 * @param value - Raw delivery key.
 * @returns Branded IpcDeliveryKey.
 */
export function parseIpcDeliveryKey(value: string): IpcDeliveryKey {
  if (value.trim() === '') throw new TypeError('IpcDeliveryKey cannot be empty')
  return brandString<IpcDeliveryKey>(value)
}

/**
 * Brand a raw string as an IpcTenantId.
 *
 * @param value - Raw tenant ID.
 * @returns Branded IpcTenantId.
 */
export function parseIpcTenantId(value: string): IpcTenantId {
  if (value.trim() === '') throw new TypeError('IpcTenantId cannot be empty')
  return brandString<IpcTenantId>(value)
}

/**
 * Brand a raw string as an IpcIngressId.
 *
 * @param value - Raw ingress ID.
 * @returns Branded IpcIngressId.
 */
export function parseIpcIngressId(value: string): IpcIngressId {
  if (value.trim() === '') throw new TypeError('IpcIngressId cannot be empty')
  return brandString<IpcIngressId>(value)
}

/**
 * Brand a raw string as an IpcOperatorId.
 *
 * @param value - Raw operator ID.
 * @returns Branded IpcOperatorId.
 */
export function parseIpcOperatorId(value: string): IpcOperatorId {
  if (value.trim() === '') throw new TypeError('IpcOperatorId cannot be empty')
  return brandString<IpcOperatorId>(value)
}

// --- Wire Schemas (Strict & Discriminated) ---

/**
 * Strict schema validating incoming client handshake.
 */
export const initRequestSchema = z.object({
  id: z.string().min(1),
  type: z.literal('init'),
  protocolVersion: z.number().int(),
  ingressId: z.string().min(1),
  targetTenantId: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
}).strict()
/** Ingress identity and tenant handshake request. */
export type InitRequest = z.infer<typeof initRequestSchema>

/**
 * Strict schema validating incoming prompt delivery.
 */
export const submitDeliveryRequestSchema = z.object({
  id: z.string().min(1),
  type: z.literal('submit_delivery'),
  deliveryKey: z.string().min(1),
  requestId: z.string().min(1),
  operatorId: z.string().min(1),
  prompt: z.string(),
  sessionId: z.string().min(1).nullable(),
  clientTimeZone: z.string().optional(),
}).strict()
/** Validated durable delivery admission request. */
export type SubmitDeliveryRequest = z.infer<typeof submitDeliveryRequestSchema>

/**
 * Strict schema validating delivery status inquiry.
 */
export const getDeliveryRequestSchema = z.object({
  id: z.string().min(1),
  type: z.literal('get_delivery'),
  deliveryKey: z.string().min(1),
  sessionId: z.string().min(1).optional(),
}).strict()
/** Read-only reconciliation request for one delivery. */
export type GetDeliveryRequest = z.infer<typeof getDeliveryRequestSchema>

/**
 * Strict schema validating delivery cancellation.
 */
export const cancelDeliveryRequestSchema = z.object({
  id: z.string().min(1),
  type: z.literal('cancel_delivery'),
  deliveryKey: z.string().min(1),
}).strict()
/** Cancellation request for an owned delivery. */
export type CancelDeliveryRequest = z.infer<typeof cancelDeliveryRequestSchema>

/**
 * Strict schema validating turn-scoped approval argument lookup.
 */
export const getApprovalContextRequestSchema = z.object({
  id: z.string().min(1),
  type: z.literal('get_approval_context'),
  sessionId: z.string().min(1),
  callId: z.string().min(1).optional(),
}).strict()
/** Phase 2 approval lookup, which never returns tool arguments. */
export type GetApprovalContextRequest = z.infer<typeof getApprovalContextRequestSchema>

/**
 * Strict schema validating keepalive ping.
 */
export const pingRequestSchema = z.object({
  id: z.string().min(1),
  type: z.literal('ping'),
}).strict()
/** Transport liveness request. */
export type PingRequest = z.infer<typeof pingRequestSchema>

/**
 * Discriminated union schema validating any incoming client request message.
 */
export const ipcClientMessageSchema = z.discriminatedUnion('type', [
  initRequestSchema,
  submitDeliveryRequestSchema,
  getDeliveryRequestSchema,
  cancelDeliveryRequestSchema,
  getApprovalContextRequestSchema,
  pingRequestSchema,
  listInteractionsRequestSchema,
  answerInteractionRequestSchema,
])
/** Accepted client protocol messages. */
export type IpcClientMessage = z.infer<typeof ipcClientMessageSchema>

/** Base frame contract for versioned NDJSON messages. */
export interface IpcFrame {
  readonly id: string
  readonly type: string
}

/**
 * Strict schema validating server handshake acknowledgement.
 */
export const initResponseSchema = z.object({
  id: z.string().min(1),
  type: z.literal('init_ack'),
  protocolVersion: z.number().int(),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  status: z.literal('ready'),
}).strict()
/** Confirmed tenant protocol handshake. */
export type InitResponse = z.infer<typeof initResponseSchema>

/**
 * Strict schema validating prompt delivery response.
 * Includes truthful outcomes: admitted, completed, failed, cancelled, and unknown.
 */
export const submitDeliveryResponseSchema = z.object({
  id: z.string().min(1),
  type: z.literal('submit_delivery_ack'),
  deliveryKey: z.string().min(1),
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  status: z.enum(['admitted', 'completed', 'failed', 'cancelled', 'unknown']),
  resultText: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
}).strict()
/** Durable delivery admission acknowledgement. */
export type SubmitDeliveryResponse = z.infer<typeof submitDeliveryResponseSchema>

/**
 * Strict schema validating delivery reconciliation result.
 */
export const deliveryReconciliationResultSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('not_found'),
  }).strict(),
  z.object({
    state: z.literal('session_mismatch'),
    receiptSessionId: z.string().min(1),
    queriedSessionId: z.string().min(1),
  }).strict(),
  z.object({
    state: z.literal('admitted'),
    requestId: z.string().min(1),
    sessionId: z.string().min(1),
  }).strict(),
  z.object({
    state: z.literal('completed'),
    requestId: z.string().min(1),
    sessionId: z.string().min(1),
    resultText: z.string().nullable(),
  }).strict(),
  z.object({
    state: z.literal('failed'),
    requestId: z.string().min(1),
    sessionId: z.string().min(1),
    error: z.string().nullable(),
  }).strict(),
  z.object({
    state: z.literal('cancelled'),
    requestId: z.string().min(1),
    sessionId: z.string().min(1),
  }).strict(),
  z.object({
    state: z.literal('unknown'),
    requestId: z.string().min(1),
    sessionId: z.string().min(1),
    reason: z.string(),
  }).strict(),
])

/**
 * Strict schema validating get delivery response.
 */
export const getDeliveryResponseSchema = z.object({
  id: z.string().min(1),
  type: z.literal('get_delivery_ack'),
  deliveryKey: z.string().min(1),
  reconciliation: deliveryReconciliationResultSchema,
}).strict()
/** Recorded delivery state and optional final reply. */
export type GetDeliveryResponse = z.infer<typeof getDeliveryResponseSchema>

/**
 * Strict schema validating cancel delivery response.
 */
export const cancelDeliveryResponseSchema = z.object({
  id: z.string().min(1),
  type: z.literal('cancel_delivery_ack'),
  deliveryKey: z.string().min(1),
  status: z.enum(['cancelled', 'not_found', 'completed', 'failed', 'unknown']),
}).strict()
/** Acknowledgement of requested delivery cancellation. */
export type CancelDeliveryResponse = z.infer<typeof cancelDeliveryResponseSchema>

/**
 * Strict schema validating get approval context response.
 */
export const getApprovalContextResponseSchema = z.object({
  id: z.string().min(1),
  type: z.literal('get_approval_context_ack'),
  sessionId: z.string().min(1),
  context: z.null(),
}).strict()
/** Phase 2 response with no exposed approval context. */
export type GetApprovalContextResponse = z.infer<typeof getApprovalContextResponseSchema>

/**
 * Strict schema validating keepalive pong reply.
 */
export const pongResponseSchema = z.object({
  id: z.string().min(1),
  type: z.literal('pong'),
}).strict()
/** Transport liveness response. */
export type PongResponse = z.infer<typeof pongResponseSchema>

/**
 * Strict schema validating protocol or operation error envelope.
 */
export const errorResponseSchema = z.object({
  id: z.string().min(1),
  type: z.literal('error'),
  code: z.string().min(1),
  message: z.string(),
}).strict()
/** Correlated protocol or operation failure. */
export type ErrorResponse = z.infer<typeof errorResponseSchema>

/**
 * Discriminated union schema validating any incoming server response message.
 */
export const ipcServerMessageSchema = z.discriminatedUnion('type', [
  initResponseSchema,
  submitDeliveryResponseSchema,
  getDeliveryResponseSchema,
  cancelDeliveryResponseSchema,
  getApprovalContextResponseSchema,
  pongResponseSchema,
  errorResponseSchema,
  listInteractionsResponseSchema,
  answerInteractionResponseSchema,
])
/** Accepted server protocol messages. */
export type IpcServerMessage = z.infer<typeof ipcServerMessageSchema>

// --- Sanitization & Helper Functions ---

/**
 * Sanitize error messages to prevent leaking filesystem paths, authorization credentials,
 * or raw runtime internals across the IPC wire.
 *
 * @param err - Raw exception or error value.
 * @returns Redacted safe error message string.
 */
export function sanitizeErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    return 'Internal tenant operation failed'
  }
  const raw = err.message
  return raw
    .replace(/(?:bearer|token|key|password|secret)\s*[:=]\s*\S+/gi, '[REDACTED]')
    .replace(/\/[\w./\\-]+/g, (match) => {
      // Redact absolute system paths
      return match.includes('/Users/') || match.includes('/home/') || match.includes('/root/')
        ? '[PATH]'
        : match
    })
    .slice(0, 500)
}

/**
 * Wrap a promise with a bounded timeout rejection.
 *
 * @param promise - Underlying promise.
 * @param timeoutMs - Bound in milliseconds.
 * @param timeoutError - Error to throw on timeout.
 * @returns Resolved value or timeout rejection.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(timeoutError)
      }, timeoutMs)
    })
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timer)
  }
}

// --- Framing Decoder ---

/**
 * Line-delimited JSON decoder with bounded raw UTF-8 byte counting and split-sequence preservation.
 */
export class NdjsonLineBuffer {
  private readonly decoder = new StringDecoder('utf8')
  private buffer = ''
  private readonly maxFrameBytes: number

  /**
   * @param maxFrameBytes - Maximum allowed size in raw UTF-8 bytes for a single frame.
   * @throws TypeError if maxFrameBytes is not a positive safe integer.
   */
  constructor(maxFrameBytes: number = MAX_FRAME_BYTES) {
    if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0) {
      throw new TypeError(`maxFrameBytes must be a positive integer: ${maxFrameBytes}`)
    }
    this.maxFrameBytes = maxFrameBytes
  }

  /**
   * Append raw buffer chunk or string and extract completed newline-delimited frames.
   * Counts raw UTF-8 bytes before trimming whitespace to prevent padding bypasses.
   *
   * @param chunk - Incoming Buffer or string chunk.
   * @returns Array of parsed JSON values.
   * @throws Error if any uncompleted line, raw frame, or residual buffer exceeds maxFrameBytes.
   */
  push(chunk: Buffer | string): unknown[] {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    this.buffer += text

    // Check uncompleted buffer before extracting lines
    if (!this.buffer.includes('\n') && Buffer.byteLength(this.buffer, 'utf8') > this.maxFrameBytes) {
      this.buffer = ''
      throw new Error(`Frame size exceeded maximum limit of ${this.maxFrameBytes} bytes`)
    }

    const messages: unknown[] = []
    let newlineIndex: number
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const rawFrame = this.buffer.slice(0, newlineIndex)
      this.buffer = this.buffer.slice(newlineIndex + 1)

      // Count RAW UTF-8 bytes BEFORE trim to prevent whitespace-padded bypasses
      if (Buffer.byteLength(rawFrame, 'utf8') > this.maxFrameBytes) {
        this.buffer = ''
        throw new Error(`Frame size exceeded maximum limit of ${this.maxFrameBytes} bytes`)
      }

      const line = rawFrame.trim()
      if (line.length > 0) {
        messages.push(JSON.parse(line))
      }
    }

    // Residual buffer after processing all complete lines
    if (Buffer.byteLength(this.buffer, 'utf8') > this.maxFrameBytes) {
      this.buffer = ''
      throw new Error(`Residual buffer size exceeded maximum limit of ${this.maxFrameBytes} bytes`)
    }

    return messages
  }
}

// --- Configuration Interfaces ---

/**
 * Validated configuration options for TenantIpcSession.
 */
export interface TenantIpcSessionConfig {
  /** Expected target tenant runtime identifier. */
  readonly expectedTenantId: string
  /** Optional expected workspace identifier. */
  readonly expectedWorkspaceId?: string | undefined
  /** Handshake deadline in milliseconds. */
  readonly handshakeTimeoutMs?: number | undefined
  /** Individual request operation execution deadline in milliseconds. */
  readonly operationTimeoutMs?: number | undefined
  /** Shutdown and quiescence drain deadline in milliseconds. */
  readonly shutdownTimeoutMs?: number | undefined
  /** Maximum frame ceiling in raw UTF-8 bytes. */
  readonly maxFrameBytes?: number | undefined
  /** Maximum concurrent in-flight operations before rejection. */
  readonly maxActiveOperations?: number | undefined
  /** Maximum write buffer size before awaiting drain backpressure. */
  readonly maxBufferedBytes?: number | undefined
}

/**
 * Validated configuration options for TenantIpcServer.
 */
export interface TenantIpcServerConfig extends TenantIpcSessionConfig {
  /** Filesystem path for the AF_UNIX listening socket. */
  readonly socketPath: string
}

/**
 * Validated configuration options for TenantIpcClient.
 */
export interface TenantIpcClientConfig {
  /** Filesystem path to the tenant AF_UNIX socket. */
  readonly socketPath: string
  /** Ingress process or identifier name. */
  readonly ingressId: string
  /** Expected tenant identifier. */
  readonly targetTenantId: string
  /** Optional corporate workspace identifier. */
  readonly workspaceId?: string | undefined
  /** Socket connection establishment deadline in milliseconds. */
  readonly connectTimeoutMs?: number | undefined
  /** Handshake initialization deadline in milliseconds. */
  readonly handshakeTimeoutMs?: number | undefined
  /** Per-request roundtrip deadline in milliseconds. */
  readonly requestTimeoutMs?: number | undefined
  /** Maximum concurrent pending client requests before backpressure rejection. */
  readonly maxPendingRequests?: number | undefined
  /** Maximum frame ceiling in raw UTF-8 bytes. */
  readonly maxFrameBytes?: number | undefined
  /** Expected socket owner UID (defaults to current process UID). */
  readonly trustedUid?: number | undefined
  /** Expected socket owner GID. */
  readonly trustedGid?: number | undefined
  /** Production systemd socket root; requires trustedUid=0, explicit trustedGid and exact protected modes. */
  readonly systemdSocketRoot?: string | undefined
}

function validatePositiveInt(val: number | undefined, name: string): void {
  if (val !== undefined && (!Number.isSafeInteger(val) || val <= 0)) {
    throw new TypeError(`${name} must be a positive integer, received: ${val}`)
  }
}

/** Rejection issued only before a submission reserves any durable or Agent work. */
export class IpcNotAdmittedError extends Error {}

// --- Tenant Runtime Handler Contract ---

/**
 * Dispatch handler interface implemented by the tenant runtime service.
 */
export interface TenantRuntimeIpcHandler {
  /** Handle an incoming prompt delivery. */
  handleSubmitDelivery(request: SubmitDeliveryRequest): Promise<SubmitDeliveryResponse>
  /** Reconcile delivery status. */
  handleGetDelivery(request: GetDeliveryRequest): Promise<GetDeliveryResponse>
  /** Cancel an in-flight delivery. */
  handleCancelDelivery(request: CancelDeliveryRequest): Promise<CancelDeliveryResponse>
  /** Resolve approval execution context. */
  handleGetApprovalContext(request: GetApprovalContextRequest): Promise<GetApprovalContextResponse>
  /** Notify runtime of client disconnection to trigger drainage. */
  handleClientDisconnected?(): Promise<void>
  /** Return redacted live cards for the operator-bound delivery, when explicitly composed. */
  handleListInteractions?(request: ListInteractionsRequest): Promise<ListInteractionsResponse>
  /** Consume an explicit verified callback for one still-live request. */
  handleAnswerInteraction?(request: AnswerInteractionRequest): Promise<AnswerInteractionResponse>

}

// --- Tenant IPC Session ---

/**
 * Bidirectional stream session for tenant IPC.
 *
 * In production under systemd Accept=yes, wraps connected standardInput/standardOutput socket streams.
 * In local/test adapters, wraps an accepted net.Socket.
 */
export class TenantIpcSession {
  private authenticated = false
  private closing = false
  private closed = false
  private closePromise: Promise<void> | null = null
  /** Settles when stream shutdown reaches quiescence, or rejects if it cannot. */
  readonly done: Promise<void>
  private readonly completion = Promise.withResolvers<void>()
  private readonly lineBuffer: NdjsonLineBuffer
  private handshakeTimer: NodeJS.Timeout | null = null

  private readonly expectedTenantId: string
  private readonly expectedWorkspaceId?: string | undefined
  private readonly handshakeTimeoutMs: number
  private readonly operationTimeoutMs: number
  private readonly shutdownTimeoutMs: number
  private readonly maxFrameBytes: number
  private readonly maxActiveOperations: number
  private readonly maxBufferedBytes: number

  private readonly activeOperations = new Set<Promise<void>>()
  private readonly pendingWrites = new Set<Promise<boolean>>()

  private readonly onDataListener: (chunk: Buffer | string) => void
  private readonly onEndListener: () => void
  private readonly onCloseListener: () => void
  private readonly onErrorListener: (err: Error) => void
  private readonly onWritableCloseListener: () => void
  private readonly onWritableErrorListener: (err: Error) => void

  /**
   * @param readable - Incoming readable stream.
   * @param writable - Outgoing writable stream.
   * @param configOrTenantId - Config options or expected target tenant ID.
   * @param handler - Runtime dispatch handler.
   * @param onClose - Optional callback invoked when session concludes.
   */
  constructor(
    private readonly readable: Readable,
    private readonly writable: Writable,
    configOrTenantId: string | TenantIpcSessionConfig,
    private readonly handler: TenantRuntimeIpcHandler,
    private readonly onClose?: () => void | Promise<void>,
  ) {
    this.done = this.completion.promise
    // Stream events can initiate shutdown before the owning effect awaits done.
    void this.done.catch(() => { /* The owner observes the original completion promise. */ })
    const config: TenantIpcSessionConfig =
      typeof configOrTenantId === 'string'
        ? { expectedTenantId: configOrTenantId }
        : configOrTenantId

    if (!config.expectedTenantId || config.expectedTenantId.trim() === '') {
      throw new TypeError('expectedTenantId must be a non-empty string')
    }
    validatePositiveInt(config.handshakeTimeoutMs, 'handshakeTimeoutMs')
    validatePositiveInt(config.operationTimeoutMs, 'operationTimeoutMs')
    validatePositiveInt(config.shutdownTimeoutMs, 'shutdownTimeoutMs')
    validatePositiveInt(config.maxFrameBytes, 'maxFrameBytes')
    validatePositiveInt(config.maxActiveOperations, 'maxActiveOperations')
    validatePositiveInt(config.maxBufferedBytes, 'maxBufferedBytes')

    this.expectedTenantId = config.expectedTenantId
    this.expectedWorkspaceId = config.expectedWorkspaceId
    this.handshakeTimeoutMs = config.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS
    this.operationTimeoutMs = config.operationTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.shutdownTimeoutMs = config.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
    this.maxFrameBytes = config.maxFrameBytes ?? MAX_FRAME_BYTES
    this.maxActiveOperations = config.maxActiveOperations ?? DEFAULT_MAX_ACTIVE_OPERATIONS
    this.maxBufferedBytes = config.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES

    this.lineBuffer = new NdjsonLineBuffer(this.maxFrameBytes)

    this.handshakeTimer = setTimeout(() => {
      if (!this.authenticated && !this.closing) {
        const errFrame: ErrorResponse = {
          id: randomUUID(),
          type: 'error',
          code: 'ERR_HANDSHAKE_TIMEOUT',
          message: 'Handshake initialization timed out',
        }
        void this.writeFrame(errFrame)
        this.requestClose()
      }
    }, this.handshakeTimeoutMs)

    this.onDataListener = (chunk) => {
      this.handleData(chunk)
    }
    this.onEndListener = () => {
      this.requestClose()
    }
    this.onCloseListener = () => {
      this.requestClose()
    }
    this.onErrorListener = () => {
      this.requestClose()
    }
    this.onWritableCloseListener = () => {
      this.requestClose()
    }
    this.onWritableErrorListener = () => {
      this.requestClose()
    }

    this.readable.on('data', this.onDataListener)
    this.readable.on('end', this.onEndListener)
    this.readable.on('close', this.onCloseListener)
    this.readable.on('error', this.onErrorListener)

    this.writable.on('close', this.onWritableCloseListener)
    this.writable.on('error', this.onWritableErrorListener)
    if (this.readable.readableEnded || this.readable.destroyed || this.writable.destroyed) {
      queueMicrotask(() => { this.requestClose() })
    }
  }

  /**
   * Write serialized frame to output stream with bounded backpressure handling.
   */
  private writeFrame(msg: IpcServerMessage): Promise<boolean> {
    if (this.pendingWrites.size >= this.maxActiveOperations) {
      this.requestClose()
      return Promise.resolve(false)
    }
    const write = this.doWriteFrame(msg)
    this.pendingWrites.add(write)
    void write.then(() => this.pendingWrites.delete(write), () => this.pendingWrites.delete(write))
    return write
  }

  private async doWriteFrame(msg: IpcServerMessage): Promise<boolean> {
    if (this.closed || this.writable.destroyed) {
      return false
    }

    const frameStr = `${JSON.stringify(msg)}\n`
    const frameBytes = Buffer.byteLength(frameStr, 'utf8')
    if (frameBytes > this.maxFrameBytes || this.writable.writableLength + frameBytes > this.maxBufferedBytes) {
      this.requestClose()
      return false
    }

    try {
      if (this.writable.write(frameStr)) return true
      const drained = await new Promise<boolean>((resolve) => {
        const finish = (ok: boolean) => {
          clearTimeout(timer)
          this.writable.off('drain', onDrain)
          this.writable.off('error', onFailure)
          this.writable.off('close', onFailure)
          resolve(ok)
        }
        const onDrain = () => { finish(true) }
        const onFailure = () => { finish(false) }
        const timer = setTimeout(onFailure, this.operationTimeoutMs)
        this.writable.once('drain', onDrain)
        this.writable.once('error', onFailure)
        this.writable.once('close', onFailure)
      })
      if (!drained) this.requestClose()
      return drained
    } catch {
      this.requestClose()
      return false
    }
  }

  private handleData(chunk: Buffer | string): void {
    if (this.closing || this.closed) {
      return
    }

    try {
      const rawFrames = this.lineBuffer.push(chunk)
      for (const raw of rawFrames) {
        const parseResult = ipcClientMessageSchema.safeParse(raw)
        if (!parseResult.success) {
          const rawObj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
          const reqId = typeof rawObj['id'] === 'string' ? rawObj['id'] : randomUUID()
          const errFrame: ErrorResponse = {
            id: reqId,
            type: 'error',
            code: 'ERR_MALFORMED_FRAME',
            message: `Invalid wire payload: ${parseResult.error.message}`,
          }
          void this.writeFrame(errFrame)
          continue
        }

        const msg = parseResult.data

        if (!this.authenticated) {
          if (msg.type !== 'init') {
            const errFrame: ErrorResponse = {
              id: msg.id,
              type: 'error',
              code: 'ERR_UNINITIALIZED',
              message: 'First frame must be an init request',
            }
            void this.writeFrame(errFrame)
            this.requestClose()
            return
          }

          if (msg.protocolVersion !== IPC_PROTOCOL_VERSION) {
            const errFrame: ErrorResponse = {
              id: msg.id,
              type: 'error',
              code: 'ERR_PROTOCOL_MISMATCH',
              message: `Expected protocol version ${IPC_PROTOCOL_VERSION}, received ${msg.protocolVersion}`,
            }
            void this.writeFrame(errFrame)
            this.requestClose()
            return
          }

          if (msg.targetTenantId !== this.expectedTenantId) {
            const errFrame: ErrorResponse = {
              id: msg.id,
              type: 'error',
              code: 'ERR_TENANT_MISMATCH',
              message: `Socket belongs to tenant ${this.expectedTenantId}, but request targeted ${msg.targetTenantId}`,
            }
            void this.writeFrame(errFrame)
            this.requestClose()
            return
          }

          if (
            this.expectedWorkspaceId !== undefined &&
            msg.workspaceId !== undefined &&
            msg.workspaceId !== this.expectedWorkspaceId
          ) {
            const errFrame: ErrorResponse = {
              id: msg.id,
              type: 'error',
              code: 'ERR_WORKSPACE_MISMATCH',
              message: `Expected workspace ${this.expectedWorkspaceId}, but request targeted ${msg.workspaceId}`,
            }
            void this.writeFrame(errFrame)
            this.requestClose()
            return
          }

          this.authenticated = true
          if (this.handshakeTimer) {
            clearTimeout(this.handshakeTimer)
            this.handshakeTimer = null
          }
          const ack: InitResponse = {
            id: msg.id,
            type: 'init_ack',
            protocolVersion: IPC_PROTOCOL_VERSION,
            tenantId: this.expectedTenantId,
            ...(this.expectedWorkspaceId ? { workspaceId: this.expectedWorkspaceId } : {}),
            status: 'ready',
          }
          void this.writeFrame(ack)
          continue
        }

        this.routeOperation(msg)
      }
    } catch (err: unknown) {
      const errFrame: ErrorResponse = {
        id: randomUUID(),
        type: 'error',
        code: 'ERR_MALFORMED_FRAME',
        message: err instanceof Error ? err.message : String(err),
      }
      void this.writeFrame(errFrame)
      this.requestClose()
    }
  }

  private routeOperation(msg: IpcClientMessage): void {
    if (this.closing || this.closed) {
      const errFrame: ErrorResponse = {
        id: msg.id,
        type: 'error',
        code: 'ERR_SESSION_CLOSING',
        message: 'Session is closing and no longer admitting operations',
      }
      void this.writeFrame(errFrame)
      return
    }

    if (msg.type === 'ping') {
      const reply: PongResponse = { id: msg.id, type: 'pong' }
      void this.writeFrame(reply)
      return
    }

    if (msg.type === 'init') {
      const ack: InitResponse = {
        id: msg.id,
        type: 'init_ack',
        protocolVersion: IPC_PROTOCOL_VERSION,
        tenantId: this.expectedTenantId,
        ...(this.expectedWorkspaceId ? { workspaceId: this.expectedWorkspaceId } : {}),
        status: 'ready',
      }
      void this.writeFrame(ack)
      return
    }

    if (this.activeOperations.size >= this.maxActiveOperations) {
      const errFrame: ErrorResponse = {
        id: msg.id,
        type: 'error',
        code: 'ERR_CONCURRENCY_LIMIT',
        message: `Maximum active operations limit of ${this.maxActiveOperations} reached`,
      }
      void this.writeFrame(errFrame)
      return
    }

    const opPromise = (async () => {
      try {
        let reply: IpcServerMessage
        const timeoutErr = new Error(`Operation '${msg.type}' timed out after ${this.operationTimeoutMs}ms`)
        switch (msg.type) {
          case 'submit_delivery':
            reply = await withTimeout(this.handler.handleSubmitDelivery(msg), this.operationTimeoutMs, timeoutErr)
            break
          case 'get_delivery':
            reply = await withTimeout(this.handler.handleGetDelivery(msg), this.operationTimeoutMs, timeoutErr)
            break
          case 'cancel_delivery':
            reply = await withTimeout(this.handler.handleCancelDelivery(msg), this.operationTimeoutMs, timeoutErr)
            break
          case 'list_interactions':
            if (!this.handler.handleListInteractions) throw new Error('Human interactions are not configured')
            reply = await withTimeout(this.handler.handleListInteractions(msg), this.operationTimeoutMs, timeoutErr)
            break
          case 'answer_interaction':
            if (!this.handler.handleAnswerInteraction) throw new Error('Human interactions are not configured')
            reply = await withTimeout(this.handler.handleAnswerInteraction(msg), this.operationTimeoutMs, timeoutErr)
            break
          case 'get_approval_context': {
            const rawReply = await withTimeout(this.handler.handleGetApprovalContext(msg), this.operationTimeoutMs, timeoutErr)
            reply = {
              ...rawReply,
              context: null,
            }
            break
          }
        }
        await this.writeFrame(reply)
      } catch (err: unknown) {
        const sanitizedMsg = sanitizeErrorMessage(err)
        const errFrame: ErrorResponse = {
          id: msg.id,
          type: 'error',
          code: err instanceof IpcNotAdmittedError ? 'ERR_NOT_ADMITTED' : 'ERR_OPERATION_FAILED',
          message: sanitizedMsg,
        }
        await this.writeFrame(errFrame)
      }
    })()

    this.activeOperations.add(opPromise)
    void opPromise.then(
      () => this.activeOperations.delete(opPromise),
      () => this.activeOperations.delete(opPromise),
    )
  }

  /**
   * Idempotent asynchronous teardown of the active stream session.
   * Awaits in-flight handlers and invokes onClose exactly once within bounded deadline.
   */
  close(): Promise<void> {
    if (!this.closePromise) {
      this.closing = true
      // Publish before invoking callbacks, which may re-enter close().
      this.closePromise = Promise.resolve().then(() => this.doClose())
      void this.closePromise.then(this.completion.resolve, this.completion.reject)
    }
    return this.closePromise
  }

  private requestClose(): void {
    void this.close().catch(() => { /* Failure remains available through done and close(). */ })
  }

  private async doClose(): Promise<void> {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
    this.readable.removeListener('data', this.onDataListener)
    this.readable.removeListener('end', this.onEndListener)
    // Keep error listeners while the transport is alive, including failed drainage.
    const cancellation = Promise.resolve().then(() => this.onClose?.())
    const operations = Promise.all(Array.from(this.activeOperations))
    try {
      await withTimeout(
        Promise.all([cancellation, operations, Promise.all(this.pendingWrites)]),
        this.shutdownTimeoutMs,
        new Error(`Tenant IPC shutdown did not reach quiescence within ${this.shutdownTimeoutMs}ms`),
      )
    } finally {
      this.closed = true
    }
  }
}

// --- Tenant IPC Server (Local/Test Adapter) ---

/**
 * Unix socket IPC server for local socket listeners or test execution.
 * Retains writer ownership until drainage completes to avoid race conditions.
 */
export class TenantIpcServer {
  private server: Server | null = null
  private activeSocket: Socket | null = null
  private activeSession: TenantIpcSession | null = null
  private isDraining = false
  private isClosing = false
  private sessionFailure: Error | null = null
  private readonly sockets = new Set<Socket>()

  private readonly socketPath: string
  private readonly config: TenantIpcServerConfig
  private readonly handler: TenantRuntimeIpcHandler

  /**
   * @param socketPathOrConfig - Unix domain socket filesystem path or configuration object.
   * @param expectedTenantId - Target tenant runtime identifier (required if first arg is string).
   * @param handler - Runtime dispatch handler.
   */
  constructor(
    socketPathOrConfig: string | TenantIpcServerConfig,
    expectedTenantId?: string,
    handler?: TenantRuntimeIpcHandler,
  ) {
    if (typeof socketPathOrConfig === 'string') {
      if (!expectedTenantId || expectedTenantId.trim() === '') {
        throw new TypeError('expectedTenantId must be a non-empty string')
      }
      if (!handler) {
        throw new TypeError('handler must be provided')
      }
      this.socketPath = socketPathOrConfig
      this.config = {
        socketPath: socketPathOrConfig,
        expectedTenantId,
      }
      this.handler = handler
    } else {
      if (!socketPathOrConfig.socketPath || socketPathOrConfig.socketPath.trim() === '') {
        throw new TypeError('socketPath must be a non-empty string')
      }
      if (!socketPathOrConfig.expectedTenantId || socketPathOrConfig.expectedTenantId.trim() === '') {
        throw new TypeError('expectedTenantId must be a non-empty string')
      }
      if (!handler) {
        throw new TypeError('handler must be provided')
      }
      this.socketPath = socketPathOrConfig.socketPath
      this.config = socketPathOrConfig
      this.handler = handler
    }
  }

  /**
   * Start listening on the configured Unix domain socket.
   *
   * @returns Resolution once listening.
   */
  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => {
        this.sockets.add(socket)

        socket.once('close', () => {
          this.sockets.delete(socket)
        })

        // Retain writer ownership until drainage finishes: refuse second writer during active or draining state
        if (this.activeSocket !== null || this.isDraining || this.isClosing) {
          const errFrame: ErrorResponse = {
            id: randomUUID(),
            type: 'error',
            code: 'ERR_SECOND_WRITER_REFUSED',
            message: 'A client is already connected or draining on this tenant runtime socket',
          }
          try {
            socket.end(`${JSON.stringify(errFrame)}\n`)
          } catch {
            socket.destroy()
          }
          return
        }

        this.activeSocket = socket

        const onSessionClose = async () => {
          this.isDraining = true
          await this.handler.handleClientDisconnected?.()
        }

        const session = new TenantIpcSession(
          socket, socket, this.config, this.handler, onSessionClose,
        )
        this.activeSession = session
        void session.done.then(() => {
          if (this.activeSession === session) {
            this.activeSocket = null
            this.activeSession = null
            this.isDraining = false
          }
        }, (error: unknown) => {
          this.sessionFailure = error instanceof Error ? error : new Error('Tenant drainage failed')
          // Retain writer ownership permanently after uncertain drainage.
          this.isDraining = true
        })
      })

      server.once('error', reject)
      server.listen(this.socketPath, () => {
        this.server = server
        resolve()
      })
    })
  }

  /**
   * Stop the IPC server, notify disconnect handler, and close any connected client socket.
   * Awaits in-flight drainage and socket exit.
   */
  async close(): Promise<void> {
    this.isClosing = true
    try {
      await this.activeSession?.close()
      if (this.sessionFailure) throw this.sessionFailure
    } finally {
      for (const socket of this.sockets) socket.destroy()
      this.sockets.clear()
      if (this.server) {
        const server = this.server
        this.server = null
        await new Promise<void>((resolve, reject) => {
          server.close((error) => { if (error) reject(error); else resolve() })
        })
      }
    }
  }
}

// --- Tenant IPC Client ---

/**
 * Unix socket IPC client used by ingress to communicate with a tenant runtime.
 * Enforces socket path ownership, modes, no-symlink rules, and strict wire correlation.
 */
export class TenantIpcClient {
  private socket: Socket | null = null
  private connectionEpoch = 0
  private connectingPromise: Promise<InitResponse> | null = null

  private readonly socketPath: string
  private readonly config: TenantIpcClientConfig
  private readonly maxPendingRequests: number
  private readonly maxFrameBytes: number
  private readonly requestTimeoutMs: number
  private readonly connectTimeoutMs: number
  private readonly handshakeTimeoutMs: number

  private readonly pendingRequests = new Map<
    string,
    {
      expectedType: string
      requestType: string
      resolve: (msg: IpcServerMessage) => void
      reject: (err: Error) => void
      timer: NodeJS.Timeout
    }
  >()

  /**
   * @param socketPathOrConfig - Unix socket filesystem path or configuration options.
   * @param ingressId - Ingress process or identifier name.
   * @param targetTenantId - Expected tenant identifier.
   */
  constructor(
    socketPathOrConfig: string | TenantIpcClientConfig,
    ingressId?: string,
    targetTenantId?: string,
  ) {
    if (typeof socketPathOrConfig === 'string') {
      if (!ingressId || ingressId.trim() === '') {
        throw new TypeError('ingressId must be a non-empty string')
      }
      if (!targetTenantId || targetTenantId.trim() === '') {
        throw new TypeError('targetTenantId must be a non-empty string')
      }
      this.socketPath = socketPathOrConfig
      this.config = {
        socketPath: socketPathOrConfig,
        ingressId,
        targetTenantId,
      }
    } else {
      if (!socketPathOrConfig.socketPath || socketPathOrConfig.socketPath.trim() === '') {
        throw new TypeError('socketPath must be a non-empty string')
      }
      if (!socketPathOrConfig.ingressId || socketPathOrConfig.ingressId.trim() === '') {
        throw new TypeError('ingressId must be a non-empty string')
      }
      if (!socketPathOrConfig.targetTenantId || socketPathOrConfig.targetTenantId.trim() === '') {
        throw new TypeError('targetTenantId must be a non-empty string')
      }
      this.socketPath = socketPathOrConfig.socketPath
      this.config = socketPathOrConfig
    }

    validatePositiveInt(this.config.connectTimeoutMs, 'connectTimeoutMs')
    validatePositiveInt(this.config.handshakeTimeoutMs, 'handshakeTimeoutMs')
    validatePositiveInt(this.config.requestTimeoutMs, 'requestTimeoutMs')
    validatePositiveInt(this.config.maxPendingRequests, 'maxPendingRequests')
    validatePositiveInt(this.config.maxFrameBytes, 'maxFrameBytes')

    this.connectTimeoutMs = this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.handshakeTimeoutMs = this.config.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS
    this.requestTimeoutMs = this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.maxPendingRequests = this.config.maxPendingRequests ?? DEFAULT_MAX_PENDING_REQUESTS
    this.maxFrameBytes = this.config.maxFrameBytes ?? MAX_FRAME_BYTES
  }

  /**
   * Verify socket filesystem permissions and ensure it is not a symlink.
   */
  private async verifySocketPath(): Promise<void> {
    if (this.config.systemdSocketRoot !== undefined) {
      if (this.config.trustedUid !== 0 || this.config.trustedGid === undefined) {
        throw new Error('Systemd IPC requires UID 0 and an explicit group')
      }
      await verifySystemdTenantSocket({ socketPath: this.socketPath, root: this.config.systemdSocketRoot,
        groupId: this.config.trustedGid })
    }
    const stat = await fs.lstat(this.socketPath)
    if (stat.isSymbolicLink()) {
      throw new Error(`Socket path '${this.socketPath}' is a symbolic link; symlinks are rejected for security`)
    }
    if (!stat.isSocket()) {
      throw new Error(`Socket path '${this.socketPath}' is not a Unix domain socket`)
    }

    // Guard against world-writable sockets
    if ((stat.mode & 0o002) !== 0) {
      throw new Error(`Socket path '${this.socketPath}' has insecure world-writable permissions`)
    }

    // Verify owner UID if specified or default to current process UID
    const expectedUid =
      this.config.trustedUid !== undefined
        ? this.config.trustedUid
        : typeof process.getuid === 'function'
          ? process.getuid()
          : undefined

    if (expectedUid !== undefined && stat.uid !== expectedUid) {
      throw new Error(
        `Socket owner UID ${stat.uid} does not match expected trusted UID ${expectedUid}`,
      )
    }

    // Verify group GID if specified
    if (this.config.trustedGid !== undefined && stat.gid !== this.config.trustedGid) {
      throw new Error(
        `Socket group GID ${stat.gid} does not match expected trusted GID ${this.config.trustedGid}`,
      )
    }
  }

  /**
   * Inspect cached transport availability.
   * @returns Whether the transport remains open; connect() owns handshake readiness.
   */
  isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed
  }

  /**
   * Connect to the tenant socket and execute the initialization handshake.
   * Prevents concurrent connection races and enforces path validation.
   *
   * @returns Initialized response from the tenant runtime.
   */
  async connect(): Promise<InitResponse> {
    if (this.socket && !this.socket.destroyed) {
      throw new Error('TenantIpcClient is already connected')
    }
    if (this.connectingPromise) {
      return this.connectingPromise
    }

    this.connectingPromise = this.doConnect()
    try {
      return await this.connectingPromise
    } finally {
      this.connectingPromise = null
    }
  }

  private async doConnect(): Promise<InitResponse> {
    await this.verifySocketPath()

    const epoch = ++this.connectionEpoch
    const lineBuffer = new NdjsonLineBuffer(this.maxFrameBytes)

    return new Promise<InitResponse>((resolve, reject) => {
      let connectTimer: NodeJS.Timeout | null = null
      let handshakeTimer: NodeJS.Timeout | null = null

      const socket = createConnection(this.socketPath)

      const cleanupTimers = () => {
        if (connectTimer) clearTimeout(connectTimer)
        if (handshakeTimer) clearTimeout(handshakeTimer)
      }

      connectTimer = setTimeout(() => {
        cleanupTimers()
        socket.destroy()
        reject(new Error(`Connecting to socket '${this.socketPath}' timed out after ${this.connectTimeoutMs}ms`))
      }, this.connectTimeoutMs)

      const onConnectError = (err: Error) => {
        cleanupTimers()
        socket.destroy()
        reject(err)
      }
      socket.once('error', onConnectError)

      socket.once('connect', () => {
        if (this.connectionEpoch !== epoch) {
          socket.destroy()
          return
        }

        if (connectTimer) {
          clearTimeout(connectTimer)
          connectTimer = null
        }
        socket.removeListener('error', onConnectError)
        this.socket = socket

        // Permanent error listener
        socket.on('error', (err) => {
          if (this.connectionEpoch !== epoch) return
          for (const pending of this.pendingRequests.values()) {
            clearTimeout(pending.timer)
            pending.reject(err)
          }
          this.pendingRequests.clear()
        })

        socket.on('data', (data) => {
          if (this.connectionEpoch !== epoch) return
          try {
            const rawFrames = lineBuffer.push(data)
            for (const raw of rawFrames) {
              const parseResult = ipcServerMessageSchema.safeParse(raw)
              if (!parseResult.success) {
                const rawObj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
                const reqId = typeof rawObj['id'] === 'string' ? rawObj['id'] : undefined
                if (reqId) {
                  const pending = this.pendingRequests.get(reqId)
                  if (pending) {
                    this.pendingRequests.delete(reqId)
                    clearTimeout(pending.timer)
                    pending.reject(new Error(`Server sent malformed response: ${parseResult.error.message}`))
                  }
                }
                continue
              }

              const msg = parseResult.data
              const pending = this.pendingRequests.get(msg.id)
              if (pending) {
                this.pendingRequests.delete(msg.id)
                clearTimeout(pending.timer)

                if (msg.type === 'error') {
                  pending.reject(msg.code === 'ERR_NOT_ADMITTED' && pending.requestType === 'submit_delivery'
                    ? new IpcNotAdmittedError(msg.message) : new Error(`[${msg.code}] ${msg.message}`))
                } else if (msg.type !== pending.expectedType) {
                  pending.reject(
                    new Error(
                      `Correlation mismatch: expected '${pending.expectedType}' for request '${pending.requestType}' (id=${msg.id}), received '${msg.type}'`,
                    ),
                  )
                } else {
                  pending.resolve(msg)
                }
              } else if (msg.type === 'error') {
                // Uncorrelated error: reject all pending requests
                for (const p of this.pendingRequests.values()) {
                  clearTimeout(p.timer)
                  p.reject(new Error(`[${msg.code}] ${msg.message}`))
                }
                this.pendingRequests.clear()
              }
            }
          } catch (err: unknown) {
            socket.destroy(err instanceof Error ? err : new Error(String(err)))
          }
        })

        socket.on('close', () => {
          if (this.connectionEpoch !== epoch) return
          this.socket = null
          for (const pending of this.pendingRequests.values()) {
            clearTimeout(pending.timer)
            pending.reject(new Error('IPC socket connection closed'))
          }
          this.pendingRequests.clear()
        })

        // Execute init handshake
        const initReq: InitRequest = {
          id: randomUUID(),
          type: 'init',
          protocolVersion: IPC_PROTOCOL_VERSION,
          ingressId: this.config.ingressId,
          targetTenantId: this.config.targetTenantId,
          ...(this.config.workspaceId ? { workspaceId: this.config.workspaceId } : {}),
        }

        handshakeTimer = setTimeout(() => {
          cleanupTimers()
          void this.close()
          reject(new Error(`Handshake with tenant timed out after ${this.handshakeTimeoutMs}ms`))
        }, this.handshakeTimeoutMs)

        this.sendRequest<InitResponse>(initReq, 'init_ack', this.handshakeTimeoutMs)
          .then((ack) => {
            if (ack.protocolVersion !== IPC_PROTOCOL_VERSION || ack.tenantId !== this.config.targetTenantId
              || (this.config.workspaceId !== undefined && ack.workspaceId !== this.config.workspaceId)) {
              throw new Error('Tenant handshake identity mismatch: protocol, tenant or workspace differs')
            }
            cleanupTimers()
            resolve(ack)
          })
          .catch((err: unknown) => {
            cleanupTimers()
            void this.close()
            reject(err instanceof Error ? err : new Error(String(err)))
          })
      })
    })
  }

  private sendRequest<T extends IpcServerMessage>(
    request: IpcClientMessage,
    expectedType: string,
    timeoutMs: number = this.requestTimeoutMs,
  ): Promise<T> {
    if (!this.socket || this.socket.destroyed) {
      return Promise.reject(new Error('TenantIpcClient is not connected'))
    }

    if (this.pendingRequests.size >= this.maxPendingRequests) {
      return Promise.reject(
        new Error(`TenantIpcClient maximum pending requests limit (${this.maxPendingRequests}) reached`),
      )
    }

    const frame = `${JSON.stringify(request)}\n`
    if (Buffer.byteLength(frame, 'utf8') > this.maxFrameBytes
      || this.socket.writableLength + Buffer.byteLength(frame, 'utf8') > this.maxFrameBytes) {
      return Promise.reject(new Error('IPC outgoing frame or buffered output exceeds configured limit'))
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(request.id)
        reject(
          new Error(`IPC request '${request.type}' (id=${request.id}) timed out after ${timeoutMs}ms`),
        )
      }, timeoutMs)

      this.pendingRequests.set(request.id, {
        expectedType,
        requestType: request.type,
        resolve: resolve as (msg: IpcServerMessage) => void,
        reject,
        timer,
      })

      this.socket?.write(frame, (err) => {
        if (err) {
          this.pendingRequests.delete(request.id)
          clearTimeout(timer)
          reject(err)
        }
      })
    })
  }

  /**
   * Submit an authenticated delivery to the tenant runtime.
   *
   * @param params - Submission parameters.
   * @param timeoutMs - Optional request timeout.
   * @returns Submission outcome.
   */
  submitDelivery(
    params: {
      readonly deliveryKey: string
      readonly requestId: string
      readonly operatorId: string
      readonly prompt: string
      readonly sessionId: string | null
      readonly clientTimeZone?: string | undefined
    },
    timeoutMs?: number,
  ): Promise<SubmitDeliveryResponse> {
    const req: SubmitDeliveryRequest = {
      id: randomUUID(),
      type: 'submit_delivery',
      deliveryKey: params.deliveryKey,
      requestId: params.requestId,
      operatorId: params.operatorId,
      prompt: params.prompt,
      sessionId: params.sessionId,
      clientTimeZone: params.clientTimeZone,
    }
    return this.sendRequest<SubmitDeliveryResponse>(req, 'submit_delivery_ack', timeoutMs)
  }

  /**
   * Query delivery status and reconciliation from the tenant runtime.
   *
   * @param deliveryKey - Canonical delivery key.
   * @param sessionId - Optional session ID.
   * @returns Delivery status response.
   */
  getDelivery(deliveryKey: string, sessionId?: string): Promise<GetDeliveryResponse> {
    const req: GetDeliveryRequest = {
      id: randomUUID(),
      type: 'get_delivery',
      deliveryKey,
      sessionId,
    }
    return this.sendRequest<GetDeliveryResponse>(req, 'get_delivery_ack')
  }

  /**
   * Cancel an in-flight delivery in the tenant runtime.
   *
   * @param deliveryKey - Canonical delivery key.
   * @returns Cancellation response.
   */
  cancelDelivery(deliveryKey: string): Promise<CancelDeliveryResponse> {
    const req: CancelDeliveryRequest = {
      id: randomUUID(),
      type: 'cancel_delivery',
      deliveryKey,
    }
    return this.sendRequest<CancelDeliveryResponse>(req, 'cancel_delivery_ack')
  }

  /**
   * Query turn-scoped approval execution context.
   *
   * @param sessionId - Session identifier.
   * @param callId - Tool call identifier.
   * @returns Approval context response.
   */
  getApprovalContext(sessionId: string, callId?: string): Promise<GetApprovalContextResponse> {
    const req: GetApprovalContextRequest = {
      id: randomUUID(),
      type: 'get_approval_context',
      sessionId,
      callId,
    }
    return this.sendRequest<GetApprovalContextResponse>(req, 'get_approval_context_ack')
  }

  /**
   * Poll current human interactions without exposing tool arguments.
   * @param deliveryKey - Current binding-selected delivery.
   * @param operatorId - Administrator-bound operator identity.
   * @returns Redacted live approval and question cards.
   */
  listInteractions(deliveryKey: string, operatorId: string): Promise<ListInteractionsResponse> {
    return this.sendRequest({ id: randomUUID(), type: 'list_interactions', deliveryKey, operatorId }, 'list_interactions_ack')
  }

  /**
   * Submit a verified answer to the current tenant interaction.
   * @param params - Verified callback actor and structured response to a current opaque action.
   * @returns Whether the exact still-live request consumed the answer.
   */
  answerInteraction(params: Omit<AnswerInteractionRequest, 'id' | 'type'>): Promise<AnswerInteractionResponse> {
    return this.sendRequest({ ...params, id: randomUUID(), type: 'answer_interaction' }, 'answer_interaction_ack')
  }

  /**
   * Send keepalive ping to the tenant runtime.
   *
   * @returns Pong response.
   */
  ping(): Promise<PongResponse> {
    const req: PingRequest = {
      id: randomUUID(),
      type: 'ping',
    }
    return this.sendRequest<PongResponse>(req, 'pong')
  }

  /**
   * Disconnect and close the IPC client, rejecting all pending requests.
   */
  close(): Promise<void> {
    this.connectionEpoch++
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('TenantIpcClient closed'))
    }
    this.pendingRequests.clear()
    return Promise.resolve()
  }
}
