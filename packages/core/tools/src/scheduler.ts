/**
 * Scheduler identity shared by the tool registry and the pipeline bundle.
 * One module keeps the symbol stable across the tsdown index and pipeline entries.
 * @module
 */

/** Scheduler entry point omitted from the generated named service API. */
export const TOOL_RUNTIME_SCHEDULER: unique symbol = Symbol('@deepseek-ai/dsh-tools.scheduler')

/** Canonical error code for cancellation before a tool body was invoked. */
export const TOOL_ABORTED_BEFORE_DISPATCH = 'ABORTED_BEFORE_DISPATCH'
