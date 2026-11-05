/** Codex-style multi-file patch tool over the guarded patch executor. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { patchOutputSchema, patchPresentationMeta, patchToolValue, renderPatch } from './apply-patch-output.ts'
import { presentPatchCall, presentPatchResult } from './apply-patch-presentation.ts'
import { executePatch } from './patch/index.ts'
import type { FsEscalationArgs, FsSandboxController } from './sandbox.ts'

/**
 * Prompt slot used by `dsh-v0.2.2-rc.1` for `TOOL_APPLY_PATCH`.
 * The current section table has no such name, so the order is the number itself.
 */
const APPLY_PATCH_SECTION_ORDER = 1350

/** Model arguments after tool-schema validation. */
interface ApplyPatchArgs extends FsEscalationArgs { input: string }

/** Rendered commit retained when caller cancellation replaces the successful value. */
const abortedReports = new WeakMap<object, string>()

/**
 * Register the patch tool and scope-aware guidance using the shared mutation controller.
 * @param ctx - plugin effect scope and filesystem services.
 * @param sandbox - per-call policy resolver and denial mapper.
 */
export function applyApplyPatchTool(ctx: Context, sandbox: FsSandboxController): void {
  ctx.systemPrompt.section({
    name: 'tool:apply_patch',
    order: APPLY_PATCH_SECTION_ORDER,
    text: ({ scope }) => ctx.tools.get('apply_patch', scope) === undefined ? ''
      : 'Prefer apply_patch over separate edit calls for changes across files or separated regions. '
        + 'Give every hunk enough surrounding context lines to match one place in the current file. '
        + 'The whole patch is checked first (syntax, hunk matching, missing files) and a rejected patch changes nothing; '
        + 'once applying starts, operations run in order, stop at the first failure, and are not rolled back, so re-read affected files before retrying when needed.',
  })
  ctx.tools.register(defineTool({
    name: 'apply_patch',
    description: 'Create, update, delete, or move UTF-8 text files with one Codex-style patch; '
      + 'prefer it over multiple edit calls when a change spans several files or separated regions.',
    parameters: {
      input: {
        type: 'string', required: true,
        description: 'Codex patch text: start with *** Begin Patch and end with *** End Patch. '
          + 'Use *** Add File: path with + lines; *** Update File: path, optionally followed by *** Move to: path, '
          + 'with @@ or @@ context and space-prefixed context, + added, or - removed lines; '
          + '*** End of File anchors the last hunk to the file end. Use *** Delete File: path to delete. '
          + 'Paths are relative to the Session working directory.',
      },
      ...sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {},
    },
    output: {
      schema: patchOutputSchema,
      render: (_args, value) => [{ type: 'text', text: renderPatch(value) }],
      presentationMeta: (_args, value) => patchPresentationMeta(value),
    },
    async execute(args: ApplyPatchArgs, exec) {
      const sandboxPolicy = await sandbox.resolvePolicy('apply_patch', args, exec)
      const value = patchToolValue(await executePatch(ctx, sandbox, exec, { patch: args.input, sandboxPolicy }))
      if (exec.signal.aborted) abortedReports.set(exec, renderPatch(value))
      return value
    },
    finalizeContent(exec, result) {
      const report = abortedReports.get(exec)
      const info = result.error?.info
      const code = typeof info === 'object' && 'code' in info ? info.code : undefined
      if (report === undefined || code !== 'ABORTED') return undefined
      return [{ type: 'text', text: `Error: tool call aborted\n${report}` }]
    },
    presentCall: args => presentPatchCall(args.input),
    presentResult: (_args, result) => presentPatchResult(result),
  }))
}
