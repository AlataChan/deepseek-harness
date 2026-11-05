/** Patch parsing and target identity shared by preflight and sequential commits. */
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsTarget, FsTargetKey, FsVersion, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import { parsePatch } from '@deepseek-ai/dsh-fs-patch'
import type { HunkApplyFailure } from '@deepseek-ai/dsh-fs-patch'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { remediateFsError } from '../error.ts'
import type { FsSandboxController } from '../sandbox.ts'
import { sessionResolveOptions } from '../session-cwd.ts'
import type { PatchExecutionRequest, PatchFailure, PatchOperationRecord, PatchPlan, PlannedOperation } from './types.ts'
import { unexpectedOperation } from './types.ts'

/**
 * Resolve every operation without dropping repeated aliases or splitting moves.
 * Relative paths use the current session cwd, or the per-call sandbox workspace
 * root when a mutation policy carries one.
 * @param ctx - filesystem service owner.
 * @param sandbox - filesystem diagnostic mapper.
 * @param exec - session cwd and execution signal.
 * @param request - raw patch and resolved per-call policy.
 * @returns resolved operations sharing one target per canonical key, plus resolution refusals.
 */
export async function planPatch(
  ctx: Context, sandbox: FsSandboxController, exec: ToolExecution, request: PatchExecutionRequest,
): Promise<PatchPlan> {
  const parsed = parsePatch(request.patch)
  const targets = new Map<FsTargetKey, FsTarget>()
  const resolveOptions = sessionResolveOptions(exec, request.sandboxPolicy?.workspaceRoot)
  const resolve = async (path: string): Promise<FsTarget> => {
    const target = await ctx.fs.resolve(path, resolveOptions)
    const prior = targets.get(target.targetKey)
    if (prior) return prior
    targets.set(target.targetKey, target)
    return target
  }
  const result: PatchPlan = { operations: [], refusals: [] }
  for (const [index, operation] of parsed.entries()) {
    const moveTo = operation.kind === 'update' ? operation.moveTo : undefined
    const record: PatchOperationRecord = {
      index, kind: moveTo === undefined ? operation.kind : 'move', path: operation.path, patchLine: operation.lineNumber,
      ...(moveTo === undefined ? {} : { destination: moveTo }),
    }
    let failurePath = operation.path
    try {
      const target = await resolve(operation.path)
      record.path = target.displayPath
      const base = { target, rawPath: operation.path, record }
      switch (operation.kind) {
        case 'add': result.operations.push({ ...base, kind: 'add', content: operation.content }); break
        case 'delete': result.operations.push({ ...base, kind: 'delete' }); break
        case 'update': {
          if (operation.moveTo === undefined) result.operations.push({ ...base, kind: 'update', hunks: operation.hunks })
          else {
            failurePath = operation.moveTo
            const destination = await resolve(operation.moveTo)
            record.destination = destination.displayPath
            result.operations.push({
              ...base, kind: 'move', destination, rawDestination: operation.moveTo, hunks: operation.hunks,
            })
          }
          break
        }
        /* v8 ignore start -- parsePatch returns only add, delete, and update. */
        default: unexpectedOperation(operation)
        /* v8 ignore stop */
      }
    } catch (error) {
      /* v8 ignore next -- resolve rejects with FsError; any other rejection is a programming defect. */
      if (!(error instanceof FsError)) throw error
      result.refusals.push({ operation: record, failure: patchFailure(sandbox, request.sandboxPolicy, error, failurePath) })
    }
  }
  return result
}

/**
 * Obtain a source guard without recording an observation.
 * Delete uses `fs/delete-intent`. Edit and move use `fs/edit-intent`.
 * Both require a present observation at its version when the policy is mounted.
 * @param ctx - intent dispatcher.
 * @param exec - opaque observation actor.
 * @param target - resolved source.
 * @param kind - mutation intent used to authorize the source.
 * @returns the observed version, or undefined for a bare provider.
 */
export function sourceIntent(
  ctx: Context, exec: ToolExecution, target: FsTarget, kind: 'edit' | 'delete' = 'edit',
): Promise<{ version: FsVersion } | undefined> {
  const event = kind === 'delete' ? 'fs/delete-intent' : 'fs/edit-intent'
  return ctx.waterfall(event, target, exec, () => undefined)
}

/**
 * Obtain a write guard without recording an observation.
 * @param ctx - intent dispatcher.
 * @param exec - opaque observation actor.
 * @param target - resolved write destination.
 * @returns the observed write intent, or undefined for a bare provider.
 */
export function destinationIntent(ctx: Context, exec: ToolExecution, target: FsTarget): Promise<FsWriteIntent | undefined> {
  return ctx.waterfall('fs/write-intent', target, exec, () => undefined)
}

/**
 * Preserve filesystem codes while applying the existing model-facing error policy.
 * @param sandbox - shared denial mapper.
 * @param policy - policy supplied by the request.
 * @param error - expected filesystem failure.
 * @param path - display path whose operation failed.
 * @returns the remediated code and message; unexpected mapper defects reject.
 */
export function patchFailure(
  sandbox: FsSandboxController, policy: SandboxExecutionPolicy | undefined, error: FsError, path: string,
): PatchFailure {
  const mapped = remediateFsError(sandbox.mapError(error, policy), path)
  /* v8 ignore next -- mapError returns the original FsError or a replacement FsError for every failure this seam passes through. */
  if (!(mapped instanceof FsError)) return { code: error.code, message: error.message }
  return { code: mapped.code, message: mapped.message }
}

/**
 * Model-facing diagnostic for one unmatched hunk. The code stays on the tool
 * because the current filesystem error union has no patch-mismatch member.
 * @param displayPath - resolved path shown to the model.
 * @param failure - structured matcher failure.
 * @returns the refusal diagnostic, including the hunk's patch line.
 */
export function hunkMismatch(displayPath: string, failure: HunkApplyFailure): PatchFailure {
  const first = failure.pattern.slice(0, 1).join('')
  const characters = Array.from(first)
  const preview = characters.length > 80 ? `${characters.slice(0, 80).join('')}…` : first
  return {
    code: 'FS_PATCH_MISMATCH',
    hunkLine: failure.hunkLineNumber,
    message: `cannot patch "${displayPath}": hunk at patch line ${failure.hunkLineNumber} (${failure.stage}) does not match — ${preview}`,
  }
}

/**
 * List all targets the operation can mutate, with destination first for a move.
 * @param operation - resolved operation.
 * @returns targets whose versions the uncertainty comparison records.
 */
export function mutationTargets(operation: PlannedOperation): FsTarget[] {
  return operation.kind === 'move' ? [operation.destination, operation.target] : [operation.target]
}
