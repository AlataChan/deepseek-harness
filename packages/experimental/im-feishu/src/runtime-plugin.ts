/** Tenant process lifetime: durable sessions, receipt reconciliation and one explicit IPC transport. */
import { join } from 'node:path'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { TenantReceiptStorage, tenantReceiptDomainSpec } from './storage.ts'
import { TenantRuntimeService } from './runtime-service.ts'
import { TenantIpcSession, TenantIpcServer, type TenantRuntimeIpcHandler,
  DEFAULT_HANDSHAKE_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS, MAX_FRAME_BYTES,
  DEFAULT_MAX_ACTIVE_OPERATIONS, DEFAULT_MAX_BUFFERED_BYTES } from './ipc.ts'
import { ImWriterLease } from './writer-lease.ts'
import { parseOperatorId, parseTargetTenantId } from './types.ts'
import { createTenantAgentSessionProvider, type TenantAgentSessionProvider } from './session-provider.ts'
import { ApprovalActionStore, approvalActionDomain, approvalActionConfigSchema } from './approval-actions.ts'
import { TenantApprovalBroker } from './approval-broker.ts'
import { TenantQuestionBroker, questionActionDomain, questionBrokerConfigSchema } from './question-broker.ts'
import { TenantInteractionHandler } from './interaction-handler.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { imRuntime: TenantRuntimeService }
}

export const name = 'im-runtime'
export const inject = ['agents', 'sessions', 'sessionPersistence', 'storage']

/** Optional human interactions; absence leaves the Phase 2 runtime without an IM approval answerer. */
export const runtimeInteractionConfigSchema = z.object({
  approvals: approvalActionConfigSchema, questions: questionBrokerConfigSchema,
  maxTrackedCalls: z.number().int().positive(),
}).strict()
/** Explicit runtime identity, private directories, transport and bounded-work settings. */
export const runtimePluginConfigSchema = z.object({
  tenantId: z.string().min(1), operatorIds: z.array(z.string().min(1)).min(1),
  stateDirectory: z.string().min(1), cwd: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  shutdownTimeoutMs: z.number().int().positive().max(2147483647).default(10000),
  requestTimeoutMs: z.number().int().positive().default(DEFAULT_REQUEST_TIMEOUT_MS),
  handshakeTimeoutMs: z.number().int().positive().default(DEFAULT_HANDSHAKE_TIMEOUT_MS),
  maxFrameBytes: z.number().int().positive().default(MAX_FRAME_BYTES),
  maxActiveOperations: z.number().int().positive().default(DEFAULT_MAX_ACTIVE_OPERATIONS),
  maxBufferedBytes: z.number().int().positive().default(DEFAULT_MAX_BUFFERED_BYTES),
  maxActiveDeliveries: z.number().int().positive().default(1),
  maxReconciliationEvents: z.number().int().positive().default(1000),
  socketPath: z.string().min(1).optional(), useSystemdStdio: z.boolean().default(false),
  modelSelection: z.object({ provider: z.string().min(1), model: z.string().min(1) }).strict().optional(),
  interactions: runtimeInteractionConfigSchema.optional(),
}).strict().refine(config => Number(config.useSystemdStdio) + Number(Boolean(config.socketPath)) === 1,
  'Runtime requires exactly one transport: useSystemdStdio or socketPath')
  .transform(config => ({ ...config, workspaceId: config.workspaceId ?? config.cwd }))
/** Runtime settings before validated default resolution. */
export type RuntimePluginRawConfig = z.input<typeof runtimePluginConfigSchema>
/** Resolved runtime deployment settings. */
export type RuntimePluginConfig = z.output<typeof runtimePluginConfigSchema>

/**
 * Mount the tenant runtime and register cleanup before opening any durable domain.
 * @param ctx - Context owning Agents, Sessions and persistence; stdio requires the actual dsh launcher services.
 * @param rawConfig - Administrator configuration; incoming messages cannot replace these values.
 */
export async function apply(ctx: Context, rawConfig: RuntimePluginRawConfig): Promise<void> {
  const config = runtimePluginConfigSchema.parse(rawConfig)
  if (!ctx.get('sessionPersistence')) throw new Error('IM runtime requires the Session persistence service')
  const appExit = ctx.get('appExit')
  const appReady = ctx.get('appReady')
  if (config.useSystemdStdio && (!appExit || !appReady)) {
    throw new Error('IM stdio runtime requires launcher appExit and appReady services')
  }
  if (config.interactions && (!ctx.get('approval') || !ctx.get('userQuestions') || !ctx.get('tools'))) {
    throw new Error('IM interactions require approval, userQuestions and tools services')
  }
  const lease = await ImWriterLease.acquire(config.stateDirectory)
  let session: TenantIpcSession | undefined
  let server: TenantIpcServer | undefined
  let runtime: TenantRuntimeService | undefined
  let provider: TenantAgentSessionProvider | undefined
  let approvals: TenantApprovalBroker | undefined
  let questions: TenantQuestionBroker | undefined
  let sqlite: SqliteStorageBackend | undefined
  let unregisterBackend: (() => void) | undefined
  let closing: Promise<void> | undefined
  const cleanup = (): Promise<void> => {
    if (closing) return closing
    closing = Promise.resolve().then(async () => {
      const quiesce = async () => {
        const work: Promise<unknown>[] = []
        if (approvals) work.push(approvals.close())
        if (questions) work.push(questions.close())
        if (session) work.push(session.close())
        if (server) work.push(server.close())
        if (runtime) work.push(runtime.handleClientDisconnected())
        const results = await Promise.allSettled(work)
        const errors: unknown[] = []
        for (const result of results) if (result.status === 'rejected') errors.push(result.reason)
        if (provider) {
          try { await provider.dispose() } catch (error) { errors.push(error) }
        }
        if (errors.length) throw new AggregateError(errors, 'IM tenant did not become quiescent')
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([quiesce(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => { reject(new Error('IM runtime shutdown deadline exceeded')) }, config.shutdownTimeoutMs)
        })])
      } finally { clearTimeout(timer) }
      await sqlite?.close()
      unregisterBackend?.()
      await lease.release()
    })
    return closing
  }
  ctx.effect(() => cleanup, 'IM tenant ownership')

  try {
    sqlite = new SqliteStorageBackend({ path: join(config.stateDirectory, 'tenant-runtime.sqlite'), journalMode: 'wal' })
    const backendKey = `sqlite:im-tenant:${config.tenantId}`
    unregisterBackend = ctx.storage.backend.register(backendKey, sqlite)
    const facility = new DomainFacility(ctx, { backend: backendKey, routes: {} })
    const receipts = new TenantReceiptStorage(await facility.open(tenantReceiptDomainSpec))
    provider = await createTenantAgentSessionProvider(ctx, facility, { cwd: config.cwd,
      maxReconciliationEvents: config.maxReconciliationEvents,
      ...(config.modelSelection ? { modelSelection: config.modelSelection } : {}),
    })
    const service = new TenantRuntimeService({ tenantId: parseTargetTenantId(config.tenantId),
      operatorIds: config.operatorIds.map(parseOperatorId), shutdownTimeoutMs: config.shutdownTimeoutMs,
      maxActiveDeliveries: config.maxActiveDeliveries }, receipts, provider)
    runtime = service
    let handler: TenantRuntimeIpcHandler = service
    if (config.interactions) {
      approvals = new TenantApprovalBroker(ctx, { ...service.config, maxTrackedCalls: config.interactions.maxTrackedCalls },
        new ApprovalActionStore(await facility.open(approvalActionDomain), config.interactions.approvals), agent => service.ownerOf(agent))
      questions = new TenantQuestionBroker(ctx, await facility.open(questionActionDomain), config.interactions.questions,
        agent => service.ownerOf(agent))
      handler = new TenantInteractionHandler(service, approvals, questions)
    }
    const ipcConfig = { expectedTenantId: config.tenantId, expectedWorkspaceId: config.workspaceId,
      handshakeTimeoutMs: config.handshakeTimeoutMs,
      operationTimeoutMs: config.requestTimeoutMs, shutdownTimeoutMs: config.shutdownTimeoutMs,
      maxFrameBytes: config.maxFrameBytes, maxActiveOperations: config.maxActiveOperations,
      maxBufferedBytes: config.maxBufferedBytes }
    if (config.useSystemdStdio && appExit && appReady) {
      let exitActive = true
      let cancelReady = (): void => {}
      ctx.effect(() => () => { exitActive = false; cancelReady() }, 'IM stdio completion exit')
      session = new TenantIpcSession(process.stdin, process.stdout, ipcConfig, handler,
        () => service.handleClientDisconnected())
      void session.done.then(() => {
        if (exitActive) cancelReady = appReady.onReady(() => { appExit(0) })
      }, (error: unknown) => {
        ctx.logger.error('IM runtime transport shutdown failed', error)
        if (exitActive) cancelReady = appReady.onReady(() => { appExit(1) })
      })
    } else if (config.socketPath) {
      server = new TenantIpcServer({ ...ipcConfig, socketPath: config.socketPath }, undefined, handler)
      await server.listen()
    }
    ctx.provide('imRuntime', service)
  } catch (error) {
    try { await cleanup() } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'IM runtime startup failed') }
    throw error
  }
}
