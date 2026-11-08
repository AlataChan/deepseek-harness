import { RUNTIME_LOCK_ID } from './runtime-lock.ts'
import { scrubText } from './result.ts'
/**
 * Safe prerequisite setup planner and dependency execution service for Agent-Reach.
 *
 * Implements user approval gating, atomic staging directories, and frozen package plans.
 * Fails closed without modifying the host when verified distribution archives are unavailable.
 *
 * @module @deepseek-ai/dsh-experimental-agent-reach/setup
 */

import * as os from 'node:os'
import * as path from 'node:path'
import type ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ReachInstaller } from './installer.ts'
import { readInstallationRecordDetailed } from './installation-record.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import { resolveConfig, type AgentReachConfig, type ResolvedAgentReachConfig } from './catalog.ts'
import { computeSetupPlan, type SetupPlan } from './setup-plan.ts'
import type { AgentReachError } from './types.ts'

/** Caller identity and cancellation; no approval-bypass option exists. */
export interface SetupExecutionOptions {
  readonly planOnly?: boolean | undefined
  readonly agent?: Agent | undefined
  readonly signal?: AbortSignal | undefined
  readonly callId?: ToolCallId | undefined
}

/** Explicit setup outcome, including refusal and unsupported recipes. */
export interface SetupExecutionResult {
  readonly ok: boolean
  readonly channel: string
  readonly action: string
  readonly status: 'installed' | 'not_needed' | 'planned' | 'declined' | 'unsupported' | 'failed'
  readonly plan?: SetupPlan | undefined
  readonly message: string
  readonly error?: AgentReachError | undefined
}

/** One-shot approved setup; plugin disposal cancels prompts and owned work. */
export class AgentReachSetupService {
  private readonly approvalFiber: Fiber
  private approval: ApprovalService | undefined
  /** Validated deployment settings used for planning and deadlines. */
  readonly config: ResolvedAgentReachConfig
  private readonly dshHome: string
  private readonly lifetime = new AbortController()
  private readonly installer: ReachInstaller
  private activeSetupPromise: Promise<SetupExecutionResult> | null = null

  constructor(ctx: Context, config: AgentReachConfig = {}, dshHome?: string) {
    this.approvalFiber = ctx.inject(['approval'], (scope) => {
      this.approval = scope.approval
      return () => { this.approval = undefined }
    })
    this.installer = new ReachInstaller(ctx)
    ctx.effect(() => () => { this.lifetime.abort(new Error('Setup owner unloaded')) }, 'agent-reach: setup approval')
    this.config = resolveConfig(config)
    this.dshHome = dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  }

  /**
   * Plan and optionally execute prerequisite setup for a requested channel and action.
   *
   * @param channel - target channel
   * @param action - target action
   * @param backend - preferred backend
   * @param options - execution controls
   * @returns SetupExecutionResult
   */
  async runSetup(
    channel: string,
    action: string,
    backend?: string,
    options: SetupExecutionOptions = {},
  ): Promise<SetupExecutionResult> {
    const signal = AbortSignal.any([this.lifetime.signal, ...(options.signal ? [options.signal] : [])])
    if (signal.aborted) return { ok:false,channel,action,status:'failed',message:'Setup cancelled',error:{ code:'CANCELLED',message:'Setup cancelled before approval' } }
    const recordPath = path.join(this.dshHome, 'runtimes', 'agent-reach', 'releases',
      RUNTIME_LOCK_ID, 'installation-record.json')
    const existing = readInstallationRecordDetailed(recordPath)
    if (existing.status === 'corrupt') return { ok:false,channel,action,status:'failed',message:'Corrupt installation record; inspect owned runtime before setup' }
    const planRes = computeSetupPlan(
      channel,
      action,
      backend,
      this.config,
      this.dshHome,
      existing.record !== undefined,
      new Set(Object.keys(existing.record?.tools ?? {})),
    )

    if (!planRes.ok) {
      return {
        ok: false,
        channel,
        action,
        status: planRes.code === 'UNSUPPORTED' ? 'unsupported' : 'failed',
        message: planRes.error,
        error: { code: planRes.code === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'PLAN_FAILED', message: planRes.error },
      }
    }

    const plan = planRes.plan

    if (plan.isFullyProvisioned) {
      return {
        ok: true,
        channel,
        action,
        status: 'not_needed',
        plan,
        message: `Prerequisites for ${channel}/${action} are already installed.`,
      }
    }

    if (options.planOnly) {
      return {
        ok: true,
        channel,
        action,
        status: 'planned',
        plan,
        message: `Computed installation plan: ${plan.packages.map(p => `${p.name}@${p.version}`).join(', ')}`,
      }
    }

    if (this.isInstalling()) return { ok:false,channel,action,status:'failed',message:'Setup already active',error:{ code:'BUSY',message:'Setup already active' } }
    await this.approvalFiber.await()
    const approval = this.approval
    if (!approval || !options.agent || options.signal?.aborted) {
      return { ok:false,channel,action,status:'declined',plan,message:'Interactive installation approval is unavailable',
        error:{ code:'APPROVAL_DECLINED',message:'No installation permission' } }
    }
    const approved = await approval.request({
      agent: options.agent, toolName: 'reach_setup',
      ...(options.callId ? { callId:options.callId } : {}),
      signal,
      reason: `Install frozen Agent-Reach prerequisites under ${plan.releaseRoot}. ${plan.packages.map(pkg => `${pkg.name}@${pkg.version}`).join(', ')}. Frozen manifest: ${plan.manifestDigest}. Licenses: ${plan.licenseSummary.join(', ')}. This does not authorize browser session access.`,
    })
    if (approved !== 'allowed-once') {
      return { ok:false,channel,action,status:'declined',plan,message:'Installation permission was not granted',
        error:{ code:'APPROVAL_DECLINED',message:approved } }
    }
    signal.throwIfAborted()
    const refreshed = readInstallationRecordDetailed(recordPath)
    if (JSON.stringify(refreshed) !== JSON.stringify(existing)) {
      return { ok:false,channel,action,status:'failed',message:'Installation state changed during approval; request a new plan',error:{ code:'PLAN_CHANGED',message:'Frozen plan changed' } }
    }
    if (this.isInstalling()) return { ok:false,channel,action,status:'failed',plan,message:'Another setup is active',error:{ code:'BUSY',message:'Setup already active' } }

    this.activeSetupPromise = this.executePlan(plan, { ...options,signal })
    try {
      return await this.activeSetupPromise
    } finally {
      this.activeSetupPromise = null
    }
  }

  private isInstalling(): boolean { return this.activeSetupPromise !== null }

  private async executePlan(plan: SetupPlan, options: SetupExecutionOptions & { signal: AbortSignal }): Promise<SetupExecutionResult> {
    try {
      await this.installer.install(plan, this.config.setupTimeoutMs, options.signal)
      return { ok:true,channel:plan.channel,action:plan.action,status:'installed',plan,message:'Verified prerequisites installed; submit a fresh query.' }
    } catch (error) {
      const message = scrubText(String(error))
      return { ok:false,channel:plan.channel,action:plan.action,status:'failed',plan,message,
        error:{ code:options.signal.aborted ? 'CANCELLED' : 'INSTALL_FAILED',message } }
    }
  }
}
