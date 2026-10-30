/** Browser-safe desktop IM settings and status types. */

/** Platform selected by the local operator. */
export type ImChannel = 'feishu' | 'dingtalk'

/** Persisted non-secret routing and execution settings. */
export interface ConnectionConfig {
  appId: string
  tenantId: string
  chatId: string
  senderId: string
  cwd: string
  provider: string
  model: string
}

/** Redacted connection status returned over the desktop Remote gateway. */
export interface ImSnapshot {
  channel: ImChannel
  config: ConnectionConfig | null
  enabled: boolean
  secretConfigured: boolean
  phase: 'off' | 'connecting' | 'connected' | 'error'
  error: 'startup' | 'delivery' | 'storage' | 'shutdown' | null
}
