/**
 * Browser-safe process-carrier protocol shared by Node companions and WebView clients.
 * Every physical message is parsed as a wire record before codec handling;
 * every decoded logical value is parsed as a carrier frame before routing.
 * @module @deepseek-ai/dsh-client-connection-process/protocol
 */

import { z } from 'zod'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Connection correlation id; same brand as `@deepseek-ai/dsh-client-connection`. */
export type RpcId = Branded<'rpc-id'>

/**
 * Brand one validated string as a Connection correlation id.
 * @param id - validated wire identity.
 * @returns the same string with the correlation-id brand.
 */
export function RpcId(id: string): RpcId {
  return id as RpcId
}

/** Unary request envelope carried by `rpc/message`. */
export interface ClientRequest {
  type: 'client-request'
  rpcId: RpcId
  method: string
  payload: unknown
}

/** Unary response envelope carried by `rpc/message`. */
export interface ServerResponse {
  type: 'server-response'
  rpcId: RpcId
  result:
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: object } }
}

/** Closed unary RPC envelope. */
export type RpcMessage = ClientRequest | ServerResponse

/** One Client Plugin row in the companion-announced boot graph. */
export interface WebBootEntry {
  id: string
  url: string
  rev: string
  inject?: string[]
  immediately?: boolean
  external?: string[]
}

/** One combo batch; every graph entry belongs to exactly one batch. */
export interface WebBootBatch {
  phase: 'bootstrap' | 'application'
  url: string
  rev: string
  entries: string[]
}

/** Boot graph announced on `control/ready`; structurally the Host `WebBootGraph`. */
export interface WebBootGraph {
  rev: string
  entries: WebBootEntry[]
  batches: WebBootBatch[]
}

/** Current logical-carrier handshake version (Typert remotes, not ApiProxy). */
export const VSCODE_CARRIER_PROTOCOL_VERSION = 2

/** Default logical RPC cap, matching Connection's HTTP body bound. */
export const DEFAULT_MAX_LOGICAL_RPC_BYTES = 300 * 1024 * 1024

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

const opaqueIdSchema = z.string().min(1).max(128)

/** Stream-id parser and brand cast point. */
export const vsCodeStreamIdSchema = opaqueIdSchema as unknown as z.ZodType<VsCodeStreamId>

/** Fragmented-message-id parser and brand cast point. */
export const wireMessageIdSchema = opaqueIdSchema as unknown as z.ZodType<WireMessageId>

const rpcIdSchema = z.string().min(1) as unknown as z.ZodType<RpcId>

const rpcErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()),
})

const clientRequestSchema = z.object({
  type: z.literal('client-request'),
  rpcId: rpcIdSchema,
  method: z.string(),
  payload: z.unknown(),
}) as z.ZodType<ClientRequest>

/** Server-response parser; same envelope as Connection `serverResponseSchema`. */
export const serverResponseSchema = z.object({
  type: z.literal('server-response'),
  rpcId: rpcIdSchema,
  result: z.union([
    z.object({ ok: z.literal(true), value: z.unknown().optional() }),
    z.object({ ok: z.literal(false), error: rpcErrorSchema }),
  ]),
}) as z.ZodType<ServerResponse>

const rpcMessageSchema = z.discriminatedUnion('type', [
  clientRequestSchema as unknown as z.ZodObject<z.ZodRawShape>,
  serverResponseSchema as unknown as z.ZodObject<z.ZodRawShape>,
]) as unknown as z.ZodType<RpcMessage>

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

const webBootEntrySchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  rev: z.string().min(1),
  inject: z.array(z.string()).optional(),
  immediately: z.boolean().optional(),
  external: z.array(z.string()).optional(),
}).strict()

const webBootBatchSchema = z.object({
  phase: z.enum(['bootstrap', 'application']),
  url: z.string().min(1),
  rev: z.string().min(1),
  entries: z.array(z.string().min(1)),
}).strict()

const webBootGraphSchema = z.object({
  rev: z.string().min(1),
  entries: z.array(webBootEntrySchema),
  batches: z.array(webBootBatchSchema),
}).strict() as unknown as z.ZodType<WebBootGraph>

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
  graph: WebBootGraph
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
  | { type: 'stream/open'; streamId: VsCodeStreamId; endpoint: string; payload: unknown }
  | { type: 'stream/opened'; streamId: VsCodeStreamId }
  | { type: 'stream/frame'; streamId: VsCodeStreamId; value: unknown }
  | { type: 'stream/close'; streamId: VsCodeStreamId }
  | { type: 'stream/end'; streamId: VsCodeStreamId }
  | { type: 'stream/error'; streamId: VsCodeStreamId; message: string }

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
    graph: webBootGraphSchema,
    bundles: z.array(clientBundleLocationSchema),
    maxLogicalRpcBytes: z.number().int().positive(),
  }).strict(),
  z.object({ type: z.literal('control/error'), code: z.string().min(1), message: z.string() }).strict(),
  z.object({ type: z.literal('control/shutdown') }).strict(),
  z.object({ type: z.literal('control/shutdown-complete') }).strict(),
  z.object({ type: z.literal('rpc/message'), message: rpcMessageSchema }).strict(),
  z.object({
    type: z.literal('stream/open'),
    streamId: vsCodeStreamIdSchema,
    endpoint: z.string().min(1),
    payload: z.unknown(),
  }).strict(),
  z.object({ type: z.literal('stream/opened'), streamId: vsCodeStreamIdSchema }).strict(),
  z.object({ type: z.literal('stream/frame'), streamId: vsCodeStreamIdSchema, value: z.unknown() }).strict(),
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
