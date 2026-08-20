/**
 * Browser-safe protocol shared by the companion, extension host, and Webview.
 * Every physical message is parsed as a wire record before codec handling;
 * every decoded logical value is parsed as a carrier frame before routing.
 * @module @deepseek-ai/dsh-client-connection-vscode/protocol
 */

import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ClientBootGraph } from '@deepseek-ai/dsh-client-modules/client'
import type {
  HostOpenPayload, MuxOpenPayload, RpcId, RpcMessage,
  RpcReceipt, ServerRequest,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { hostOpenPayloadSchema, muxOpenPayloadSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import {
  rpcIdSchema, rpcMessageSchema, rpcReceiptSchema, serverRequestSchema,
} from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'

/** Current logical-carrier handshake version. */
export const VSCODE_CARRIER_PROTOCOL_VERSION = 1

/** Maximum serialized size of one Node IPC or Webview record. */
export const MAX_WIRE_RECORD_BYTES = 256 * 1024

/** Maximum serialized size of control, stream-open, and editor messages. */
export const MAX_CONTROL_MESSAGE_BYTES = 1024 * 1024

/** Maximum time one fragmented logical message may remain incomplete. */
export const REASSEMBLY_TIMEOUT_MS = 30_000

/** Opaque identifier of one logical event stream. */
export type VsCodeStreamId = Branded<'VsCodeStreamId'>

/**
 * Construct a stream id after its owning caller chooses the opaque value.
 * @param value - non-empty opaque identifier.
 * @returns the branded stream id.
 */
export function VsCodeStreamId(value: string): VsCodeStreamId {
  return value as VsCodeStreamId
}

/** Opaque identifier of one fragmented logical message. */
export type WireMessageId = Branded<'WireMessageId'>

/**
 * Construct a wire-message id after its owning sender chooses the opaque value.
 * @param value - non-empty opaque identifier.
 * @returns the branded wire-message id.
 */
export function WireMessageId(value: string): WireMessageId {
  return value as WireMessageId
}

/** Opaque identifier of an immutable captured editor snapshot. */
export type EditorContextId = Branded<'EditorContextId'>

/**
 * Construct an editor-context id after capture chooses the opaque value.
 * @param value - non-empty opaque identifier.
 * @returns the branded editor-context id.
 */
export function EditorContextId(value: string): EditorContextId {
  return value as EditorContextId
}

/** Opaque correlation identifier for one Webview IDE request. */
export type IdeRequestId = Branded<'IdeRequestId'>

/**
 * Construct an IDE request id after the Webview chooses a non-empty opaque value.
 * @param value - non-empty correlation identifier.
 * @returns the branded request id.
 */
export function IdeRequestId(value: string): IdeRequestId {
  return value as IdeRequestId
}

const opaqueIdSchema = z.string().min(1).max(128)

/** Stream-id parser and brand cast point. */
export const vsCodeStreamIdSchema = opaqueIdSchema as unknown as z.ZodType<VsCodeStreamId>

/** Fragmented-message-id parser and brand cast point. */
export const wireMessageIdSchema = opaqueIdSchema as unknown as z.ZodType<WireMessageId>

/** Editor-context-id parser and brand cast point. */
export const editorContextIdSchema = opaqueIdSchema as unknown as z.ZodType<EditorContextId>

/** IDE-request-id parser and brand cast point. */
export const ideRequestIdSchema = opaqueIdSchema as unknown as z.ZodType<IdeRequestId>

/** Maximum serialized size of one IDE request, response, or event. */
export const MAX_IDE_MESSAGE_BYTES = MAX_CONTROL_MESSAGE_BYTES

/** Immutable editor range captured with a context snapshot. */
export interface EditorContextRange {
  /** Zero-based start line. */
  startLine: number
  /** Zero-based start column. */
  startColumn: number
  /** Zero-based line containing the exclusive end position. */
  endLine: number
  /** Zero-based exclusive end column. */
  endColumn: number
}

/** Immutable explicit editor snapshot returned to the Client context UI. */
export interface EditorContextSnapshot {
  /** Snapshot identity retained by the Webview. */
  id: EditorContextId
  /** Explicit capture action that produced this value. */
  kind: 'selection' | 'file' | 'diagnostics'
  /** Source document URI. */
  uri: string
  /** Workspace-relative path when the URI belongs to the selected root. */
  workspacePath?: string
  /** VS Code language id when a text document supplied the snapshot. */
  languageId?: string
  /** Source document version at capture time. */
  version?: number
  /** Captured selection or diagnostic range. */
  range?: EditorContextRange
  /** Immutable captured text or deterministic diagnostic serialization. */
  text: string
  /** Epoch milliseconds recorded by the extension host. */
  capturedAt: number
}

const editorContextRangeSchema = z.object({
  startLine: z.number().int().nonnegative(),
  startColumn: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
  endColumn: z.number().int().nonnegative(),
}).strict()

/** Authoritative parser for immutable captured editor context. */
export const editorContextSnapshotSchema = z.object({
  id: editorContextIdSchema,
  kind: z.enum(['selection', 'file', 'diagnostics']),
  uri: z.string().min(1).max(32_768),
  workspacePath: z.string().max(32_768).optional(),
  languageId: z.string().min(1).max(256).optional(),
  version: z.number().int().nonnegative().optional(),
  range: editorContextRangeSchema.optional(),
  text: z.string(),
  capturedAt: z.number().int().nonnegative(),
}).strict() as unknown as z.ZodType<EditorContextSnapshot>

/** Request and result ownership for every operation available to Webview code. */
export interface IdeMethodMap {
  /** Read whether replacing the selected root would interrupt an active turn. */
  'webview.getTurnState': { payload: Record<string, never>; result: { running: boolean } }
  /** Create and select a new session through the existing Client runtime. */
  'webview.newSession': { payload: Record<string, never>; result: Record<string, never> }
  /** Read the extension-selected root after the Client Plugin subscribes to later changes. */
  'workspace.getSelectedRoot': { payload: Record<string, never>; result: { workspaceRoot: string } }
  /** Capture the active editor selection explicitly. */
  'editor.captureSelection': { payload: Record<string, never>; result: EditorContextSnapshot | null }
  /** Capture the active file explicitly. */
  'editor.captureFile': { payload: Record<string, never>; result: EditorContextSnapshot | null }
  /** Capture bounded diagnostics explicitly. */
  'editor.captureDiagnostics': { payload: Record<string, never>; result: EditorContextSnapshot | null }
  /** Ask the extension-owned runtime manager to restart. */
  'runtime.restart': { payload: Record<string, never>; result: { accepted: boolean } }
  /** Reveal the extension-owned redacted Output channel. */
  'logs.show': { payload: Record<string, never>; result: Record<string, never> }
}

/** Typed IDE request union derived from {@link IdeMethodMap}. */
export type IdeRequest = {
  [K in keyof IdeMethodMap]: {
    type: 'ide/request'
    requestId: IdeRequestId
    method: K
    payload: IdeMethodMap[K]['payload']
  }
}[keyof IdeMethodMap]

/** Typed IDE response union preserving the exact requested method. */
export type IdeResponse = {
  [K in keyof IdeMethodMap]:
    | {
      type: 'ide/response'
      requestId: IdeRequestId
      method: K
      ok: true
      result: IdeMethodMap[K]['result']
    }
    | {
      type: 'ide/response'
      requestId: IdeRequestId
      method: K
      ok: false
      error: string
    }
}[keyof IdeMethodMap]

/** Event payload ownership for extension-initiated Webview notifications. */
export interface IdeEventMap {
  /** Companion lifecycle status for in-panel presentation. */
  'runtime.state': {
    state: 'idle' | 'starting' | 'ready' | 'restarting' | 'stopping' | 'failed'
    message?: string
  }
  /** Newly selected extension companion root. */
  'workspace.selected': { workspaceRoot: string }
  /** Context captured through an extension command rather than an in-panel control. */
  'editor.contextCaptured': { snapshot: EditorContextSnapshot }
}

/** Typed IDE event union derived from {@link IdeEventMap}. */
export type IdeEvent = {
  [K in keyof IdeEventMap]: { type: 'ide/event'; event: K; payload: IdeEventMap[K] }
}[keyof IdeEventMap]

const emptyPayloadSchema = z.object({}).strict()
const ideMethodSchemas = {
  'webview.getTurnState': {
    payload: emptyPayloadSchema,
    result: z.object({ running: z.boolean() }).strict(),
  },
  'webview.newSession': { payload: emptyPayloadSchema, result: emptyPayloadSchema },
  'workspace.getSelectedRoot': {
    payload: emptyPayloadSchema,
    result: z.object({ workspaceRoot: z.string().min(1).max(32_768) }).strict(),
  },
  'editor.captureSelection': { payload: emptyPayloadSchema, result: editorContextSnapshotSchema.nullable() },
  'editor.captureFile': { payload: emptyPayloadSchema, result: editorContextSnapshotSchema.nullable() },
  'editor.captureDiagnostics': { payload: emptyPayloadSchema, result: editorContextSnapshotSchema.nullable() },
  'runtime.restart': {
    payload: emptyPayloadSchema,
    result: z.object({ accepted: z.boolean() }).strict(),
  },
  'logs.show': { payload: emptyPayloadSchema, result: emptyPayloadSchema },
} as const

const ideRequestSchemas = Object.entries(ideMethodSchemas).map(([method, schemas]) => z.object({
  type: z.literal('ide/request'),
  requestId: ideRequestIdSchema,
  method: z.literal(method),
  payload: schemas.payload,
}).strict())

const ideResponseSchemas = Object.entries(ideMethodSchemas).flatMap(([method, schemas]) => [
  z.object({
    type: z.literal('ide/response'),
    requestId: ideRequestIdSchema,
    method: z.literal(method),
    ok: z.literal(true),
    result: schemas.result,
  }).strict(),
  z.object({
    type: z.literal('ide/response'),
    requestId: ideRequestIdSchema,
    method: z.literal(method),
    ok: z.literal(false),
    error: z.string(),
  }).strict(),
])

/** Authoritative parser for Webview-to-extension IDE requests. */
export const ideRequestSchema = z.union(ideRequestSchemas as [
  (typeof ideRequestSchemas)[number],
  (typeof ideRequestSchemas)[number],
  ...(typeof ideRequestSchemas)[number][],
]) as unknown as z.ZodType<IdeRequest>

/** Authoritative parser for extension-to-Webview IDE responses. */
export const ideResponseSchema = z.union(ideResponseSchemas as [
  (typeof ideResponseSchemas)[number],
  (typeof ideResponseSchemas)[number],
  ...(typeof ideResponseSchemas)[number][],
]) as unknown as z.ZodType<IdeResponse>

const ideEventSchema = z.union([
  z.object({
    type: z.literal('ide/event'),
    event: z.literal('runtime.state'),
    payload: z.object({
      state: z.enum(['idle', 'starting', 'ready', 'restarting', 'stopping', 'failed']),
      message: z.string().optional(),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal('ide/event'),
    event: z.literal('workspace.selected'),
    payload: z.object({ workspaceRoot: z.string().min(1).max(32_768) }).strict(),
  }).strict(),
  z.object({
    type: z.literal('ide/event'),
    event: z.literal('editor.contextCaptured'),
    payload: z.object({ snapshot: editorContextSnapshotSchema }).strict(),
  }).strict(),
]) as unknown as z.ZodType<IdeEvent>

/** One companion bundle location announced beside the Client boot graph. */
export interface ClientBundleLocation {
  /** Client Plugin package id, equal to its graph row id. */
  id: string
  /** Bundle revision, equal to its graph row revision. */
  rev: string
  /** Absolute source artifact path on the companion host. */
  sourcePath: string
  /** Full SHA-256 digest used before copying the artifact into Webview storage. */
  sha256: string
}

const clientBootEntrySchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  rev: z.string().min(1),
  inject: z.array(z.string()).optional(),
  immediately: z.boolean().optional(),
}).strict()

const clientBootGraphSchema = z.object({
  rev: z.string().min(1),
  entries: z.array(clientBootEntrySchema),
}).strict() as unknown as z.ZodType<ClientBootGraph>

/** Bundle-location parser used by the ready handshake. */
export const clientBundleLocationSchema = z.object({
  id: z.string().min(1).max(256),
  rev: z.string().min(1).max(128),
  sourcePath: z.string().min(1).max(32_768),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict() as unknown as z.ZodType<ClientBundleLocation>

/** Version and workspace facts sent by the extension immediately after launch. */
export interface ControlHelloFrame {
  type: 'control/hello'
  protocolVersion: number
  extensionVersion: string
  workspaceRoot: string
  locale: string
}

/** Runtime, graph, and capacity facts returned after a successful handshake. */
export interface ControlReadyFrame {
  type: 'control/ready'
  protocolVersion: number
  runtimeVersion: string
  graph: ClientBootGraph
  bundles: ClientBundleLocation[]
  maxLogicalRpcBytes: number
}

/** Logical messages multiplexed over the bounded wire-record codec. */
export type VsCodeCarrierFrame =
  | ControlHelloFrame
  | ControlReadyFrame
  | { type: 'control/error'; code: string; message: string }
  | { type: 'control/shutdown' }
  | { type: 'control/shutdown-complete' }
  | { type: 'rpc/message'; message: RpcMessage }
  | { type: 'rpc/receipt'; rpcId: RpcId; receipt: RpcReceipt }
  | { type: 'stream/open'; streamId: VsCodeStreamId; stream: 'mux'; payload: MuxOpenPayload }
  | { type: 'stream/open'; streamId: VsCodeStreamId; stream: 'host'; payload: HostOpenPayload }
  | { type: 'stream/opened'; streamId: VsCodeStreamId }
  | { type: 'stream/frame'; streamId: VsCodeStreamId; message: ServerRequest }
  | { type: 'stream/close'; streamId: VsCodeStreamId }
  | { type: 'stream/end'; streamId: VsCodeStreamId }
  | { type: 'stream/error'; streamId: VsCodeStreamId; message: string }

const streamOpenSchema = z.discriminatedUnion('stream', [
  z.object({
    type: z.literal('stream/open'),
    streamId: vsCodeStreamIdSchema,
    stream: z.literal('mux'),
    payload: muxOpenPayloadSchema,
  }).strict(),
  z.object({
    type: z.literal('stream/open'),
    streamId: vsCodeStreamIdSchema,
    stream: z.literal('host'),
    payload: hostOpenPayloadSchema,
  }).strict(),
])

/** Authoritative parser for decoded logical carrier frames. */
export const vsCodeCarrierFrameSchema = z.union([
  z.object({
    type: z.literal('control/hello'),
    protocolVersion: z.number().int().positive(),
    extensionVersion: z.string().min(1),
    workspaceRoot: z.string().min(1),
    locale: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal('control/ready'),
    protocolVersion: z.number().int().positive(),
    runtimeVersion: z.string().min(1),
    graph: clientBootGraphSchema,
    bundles: z.array(clientBundleLocationSchema),
    maxLogicalRpcBytes: z.number().int().positive(),
  }).strict(),
  z.object({ type: z.literal('control/error'), code: z.string().min(1), message: z.string() }).strict(),
  z.object({ type: z.literal('control/shutdown') }).strict(),
  z.object({ type: z.literal('control/shutdown-complete') }).strict(),
  z.object({ type: z.literal('rpc/message'), message: rpcMessageSchema }).strict(),
  z.object({ type: z.literal('rpc/receipt'), rpcId: rpcIdSchema, receipt: rpcReceiptSchema }).strict(),
  streamOpenSchema,
  z.object({ type: z.literal('stream/opened'), streamId: vsCodeStreamIdSchema }).strict(),
  z.object({ type: z.literal('stream/frame'), streamId: vsCodeStreamIdSchema, message: serverRequestSchema }).strict(),
  z.object({ type: z.literal('stream/close'), streamId: vsCodeStreamIdSchema }).strict(),
  z.object({ type: z.literal('stream/end'), streamId: vsCodeStreamIdSchema }).strict(),
  z.object({ type: z.literal('stream/error'), streamId: vsCodeStreamIdSchema, message: z.string() }).strict(),
]) as unknown as z.ZodType<VsCodeCarrierFrame>

/** One physical record carried by Node IPC or `webview.postMessage`. */
export type VsCodeWireRecord =
  | { type: 'wire/message'; encoded: string }
  | { type: 'wire/chunk-start'; messageId: WireMessageId; totalBytes: number; sha256: string }
  | { type: 'wire/chunk'; messageId: WireMessageId; index: number; data: string }
  | { type: 'wire/chunk-end'; messageId: WireMessageId; chunks: number }

const base64Schema = z.string().min(4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)

/** Authoritative parser for physical wire records. */
export const vsCodeWireRecordSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('wire/message'), encoded: z.string() }).strict(),
  z.object({
    type: z.literal('wire/chunk-start'),
    messageId: wireMessageIdSchema,
    totalBytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  z.object({
    type: z.literal('wire/chunk'),
    messageId: wireMessageIdSchema,
    index: z.number().int().nonnegative(),
    data: base64Schema,
  }).strict(),
  z.object({
    type: z.literal('wire/chunk-end'),
    messageId: wireMessageIdSchema,
    chunks: z.number().int().positive(),
  }).strict(),
]) as unknown as z.ZodType<VsCodeWireRecord>

/** Messages crossing `webview.postMessage`; no member carries a command id. */
export type WebviewBridgeMessage =
  | { type: 'carrier'; record: VsCodeWireRecord }
  | IdeRequest
  | IdeResponse
  | IdeEvent

/** Authoritative parser for every extension-host/Webview message. */
export const webviewBridgeMessageSchema = z.union([
  z.object({ type: z.literal('carrier'), record: vsCodeWireRecordSchema }).strict(),
  ideRequestSchema,
  ideResponseSchema,
  ideEventSchema,
]) as unknown as z.ZodType<WebviewBridgeMessage>
