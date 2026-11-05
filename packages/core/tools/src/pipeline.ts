/**
 * Executor-facing view of the registry scheduler.
 * The instance is the live {@link ToolRuntime}; this module does not construct a second registry.
 * @module
 */

import type { ToolNotFoundError } from './index.ts'
import { TOOL_RUNTIME_SCHEDULER } from './scheduler.ts'
import type {
  ScheduledToolDispatch,
  ScheduledToolPreparation,
  ToolExecutionInput,
  ToolExecutionMode,
  ToolExecutionResult,
  ToolRunContext,
  ToolRuntimeScheduler,
} from './index.ts'

export type { ScheduledToolDispatch, ScheduledToolPreparation }

/** How a selected executor resolves or refuses one call before policy. */
export interface ToolExecutionSource {
  /**
   * Refuse a call before pre-execute.
   * @param name - the tool name the model or program requested.
   * @param nested - true when the call carries a parent execution token.
   * @returns the denial, or undefined when this source allows the name.
   */
  reject?(name: string, nested: boolean): ToolNotFoundError | undefined
}

/** The registry operations the pipeline invokes on the mounted service. */
export interface ToolPipelineRuntime {
  executionMode(exec: ToolExecutionInput): ToolExecutionMode
  /**
   * Materialize a pre-policy denial.
   * @param exec - the caller-supplied call.
   * @param error - the executor refusal.
   * @returns a final result, or the canonical pre-dispatch cancellation when the call is already aborted.
   */
  refuseBeforePolicy(exec: ToolExecutionInput, error: ToolNotFoundError): ScheduledToolPreparation
  readonly [TOOL_RUNTIME_SCHEDULER]: ToolRuntimeScheduler
}

/**
 * Prepare, dispatch, and complete calls through one mounted tool registry.
 * A source refusal runs before pre-execute. An already aborted call keeps
 * {@link TOOL_ABORTED_BEFORE_DISPATCH} rather than the refusal.
 */
export class ToolExecutionPipeline {
  /**
   * @param runtime - the mounted tool registry.
   * @param source - optional executor admission. Omitted uses the registry's own collapse and guards.
   */
  constructor(
    private readonly runtime: ToolPipelineRuntime,
    private readonly source?: ToolExecutionSource,
  ) {}

  /**
   * Classify one pending call. Unknown and throwing classifiers stay exclusive.
   * @param exec - the call, including step admission when the caller captured it.
   * @returns the fail-closed scheduling mode.
   */
  executionMode(exec: ToolExecutionInput): ToolExecutionMode {
    return this.runtime.executionMode(exec)
  }

  /**
   * Run ordered pre-execute and guards, or return an executor refusal.
   * @param exec - the caller-supplied call.
   * @returns the next scheduler stage.
   */
  prepare(exec: ToolExecutionInput): Promise<ScheduledToolPreparation> {
    const refusal = this.source?.reject?.(exec.name, exec.parent !== undefined)
    if (refusal !== undefined) {
      return Promise.resolve(this.runtime.refuseBeforePolicy(exec, refusal))
    }
    return this.runtime[TOOL_RUNTIME_SCHEDULER].prepare(exec)
  }

  /**
   * Run the tool body for a prepared dispatch.
   * @param exec - the registry-owned execution.
   * @returns the body outcome before post-execute.
   */
  dispatch(exec: ToolRunContext): Promise<ScheduledToolDispatch> {
    return this.runtime[TOOL_RUNTIME_SCHEDULER].dispatch(exec)
  }

  /**
   * Finish one settled slot in model order.
   * @param exec - the registry-owned execution.
   * @param slot - the body or pre-settled outcome.
   * @returns the materialized result.
   */
  complete(exec: ToolRunContext, slot: ScheduledToolDispatch): Promise<ToolExecutionResult> {
    const scheduler = this.runtime[TOOL_RUNTIME_SCHEDULER]
    return slot.kind === 'post-result'
      ? scheduler.finalize(exec, slot.result)
      : Promise.resolve(scheduler.finish(exec, slot.result))
  }
}

export { executeToolBatch } from './batch.ts'
