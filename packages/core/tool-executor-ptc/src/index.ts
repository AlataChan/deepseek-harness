/**
 * PTC execution plugin for the mounting Agent, preset, or deployment scope.
 * Program running stays in the tool registry's `run_code` transport. This
 * plugin selects that transport for a batch and refuses a model-direct call
 * of any other tool before the tool body starts.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { RUN_CODE_NAME, ToolNotFoundError } from '@deepseek-ai/dsh-tools'
import type { ToolBatchInput, ToolBatchResult, ToolDefinition, ToolExecutor, ToolModelInput } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline, executeToolBatch } from '@deepseek-ai/dsh-tools/pipeline'
import { resolveConfig } from './config.ts'
import type { Config } from './config.ts'

const DIRECT_CALL_DENIAL = `only \`${RUN_CODE_NAME}\` is callable directly — call the tool from inside a \`${RUN_CODE_NAME}\` program instead`

/** Runs a tool batch through the mounted registry, admitting only `run_code` as a model-direct call. */
export class PtcExecutor implements ToolExecutor {
  private readonly pipeline: ToolExecutionPipeline
  /** Overlap cap published with this executor. Registration stores it only after the scope accepts the executor. */
  readonly subcallLimit: number

  /**
   * @param ctx - context whose tool registry this executor uses.
   * @param config - validated subcall limit applied to the retained `run_code` transport.
   * @param maxParallel - root-call pool used when a batch does not override it.
   */
  constructor(
    private readonly ctx: Context,
    config: Partial<Config> = {},
    private readonly maxParallel: () => number = () => 10,
  ) {
    this.subcallLimit = resolveConfig(config).maxParallelSubCalls
    this.pipeline = new ToolExecutionPipeline(ctx.tools, {
      reject: (name, nested) => nested || name === RUN_CODE_NAME
        ? undefined
        : new ToolNotFoundError(name, DIRECT_CALL_DENIAL),
    })
  }

  /**
   * Describe the only model-direct tool.
   * @param _tools - visible definitions. The transport is reserved and is not taken from this list.
   * @returns the `run_code` schema.
   */
  describe(_tools: readonly ToolDefinition[]): ToolModelInput {
    return {
      schemas: [this.ctx.tools.projectSchema(this.ctx.tools.runCodeTransport())],
      knownNames: [RUN_CODE_NAME],
    }
  }

  /**
   * Execute one model batch. Nested program calls keep the captured step admission.
   * @param input - raw calls, cancellation, and optional step admission.
   * @returns model-ordered results after started bodies settle.
   */
  execute(input: ToolBatchInput): Promise<ToolBatchResult> {
    return executeToolBatch(input, this.pipeline, this.maxParallel)
  }
}

export { Config } from './config.ts'

/** Cordis plugin name. */
export const name = 'ptc-tool-executor'

/** Activate the executor only while its registry, prompt service, and runtime are available. */
export const inject = ['tools', 'systemPrompt', 'ptcRuntime'] as const

/**
 * Select PTC execution in the mounting scope.
 * A preset scope records `presentAs('ptc')`. The root context requires the
 * tools row `mode: ptc` and does not call `presentAs`.
 * @param ctx - context owning this executor's selection and lifetime.
 * @param config - program subcall concurrency limits.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.requirePtcPresentation()
  ctx.tools.setExecutor(new PtcExecutor(ctx, config))
}
