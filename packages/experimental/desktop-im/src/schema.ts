/** Validated desktop settings and public connection status; no credential values on reads. */
import { z } from 'zod'

/** Channels supported by the installed desktop integration. */
export const channelSchema = z.enum(['feishu', 'dingtalk'])
/** Local administrator-selected routing and execution settings. */
export const connectionConfigSchema = z.object({
  appId: z.string().trim().min(1).max(256), tenantId: z.string().trim().min(1).max(256),
  chatId: z.string().trim().min(1).max(256), senderId: z.string().trim().min(1).max(256),
  cwd: z.string().min(1).max(4096), provider: z.string().trim().min(1).max(256), model: z.string().trim().min(1).max(256),
}).strict()
/** Public connection lifecycle. A successful socket connection does not assert platform subscriptions. */
export const phaseSchema = z.enum(['off', 'connecting', 'connected', 'error'])
/** Settings snapshot accepted by the browser at the wire boundary. */
export const snapshotSchema = z.object({
  channel: channelSchema, config: connectionConfigSchema.nullable(), enabled: z.boolean(),
  secretConfigured: z.boolean(), phase: phaseSchema,
  error: z.enum(['startup', 'delivery', 'storage', 'shutdown']).nullable(),
}).strict()
export type { ImChannel, ConnectionConfig, ImSnapshot } from './types.ts'
