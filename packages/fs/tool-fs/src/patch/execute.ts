/** Sequential provider commits with truthful partial results and uncertainty checks. */
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsTarget, FsVersion, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import { applyHunks } from '@deepseek-ai/dsh-fs-patch'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { FsSandboxController } from '../sandbox.ts'
import { destinationIntent, hunkMismatch, mutationTargets, patchFailure, sourceIntent } from './plan.ts'
import type { PatchExecutionReport, PatchOperationOutcome, PlannedOperation } from './types.ts'
import { unexpectedOperation } from './types.ts'

interface BeforeTarget {
  target: FsTarget
  info: FsInfo | undefined
}

async function unchanged(ctx: Context, before: readonly BeforeTarget[]): Promise<boolean> {
  try {
    for (const entry of before) {
      const after = await ctx.fs.stat(entry.target)
      if (after?.version !== entry.info?.version) return false
    }
    return true
  } catch (error) {
    /* v8 ignore next -- FileSystem.stat rejects with FsError; any other rejection is a programming defect. */
    if (!(error instanceof FsError)) throw error
    return false
  }
}

function replaceIntent(intent: { version: FsVersion } | undefined): FsWriteIntent | undefined {
  return intent === undefined ? undefined : { kind: 'replaceIfVersion', version: intent.version }
}

/** Keep an existing CRLF file's endings. The hunk matcher and the diff basis stay LF. */
function storedPatchText(original: string, normalizedAfter: string): string {
  return original.includes('\r\n') ? normalizedAfter.replaceAll('\n', '\r\n') : normalizedAfter
}

/**
 * Commit a fully admitted plan; the first failure stops later operations without rollback.
 * Updates publish through `writeText` after `applyHunks`. Delete and move use the
 * provider mutations. A move that publishes the destination and keeps the source
 * reports that partial effect and does not roll the destination back.
 * @param ctx - provider and observation dispatcher.
 * @param sandbox - existing model-facing denial mapper.
 * @param exec - session actor and cancellation signal.
 * @param policy - request's resolved confinement policy.
 * @param operations - operations that all passed preflight.
 * @returns known changes, failed or unknown effects, and skipped successors in patch order.
 */
export async function commitPatch(
  ctx: Context, sandbox: FsSandboxController, exec: ToolExecution, policy: SandboxExecutionPolicy | undefined,
  operations: readonly PlannedOperation[],
): Promise<PatchExecutionReport> {
  const outcomes: PatchOperationOutcome[] = operations.map(operation => ({ status: 'skipped', operation: operation.record }))
  let cancelled = false
  for (const [index, operation] of operations.entries()) {
    if (exec.signal.aborted) { cancelled = true; break }
    let started = false
    let before: BeforeTarget[] = []
    let failurePath = operation.target.displayPath
    const target = operation.target
    const record = operation.record
    let outcome: PatchOperationOutcome
    try {
      before = await Promise.all(mutationTargets(operation).map(async item => ({
        target: item,
        info: await ctx.fs.stat(item, exec.signal),
      })))
      switch (operation.kind) {
        case 'add': {
          const intent = await destinationIntent(ctx, exec, target)
          started = true
          const result = await ctx.fs.writeText(target, operation.content, intent, exec.signal, policy)
          ctx.emit('fs/observed', target, { kind: 'present', version: result.version }, exec, 'write')
          outcome = { status: 'completed', operation: record, changes: [{ path: ctx.fs.processPath(target), before: result.before, after: result.after }] }
          break
        }
        case 'update': {
          const intent = await sourceIntent(ctx, exec, target)
          const original = await ctx.fs.readText(target, exec.signal)
          if (original.includes('\0')) throw new FsError(`cannot patch "${target.displayPath}": binary file`, 'FS_NOT_TEXT')
          const applied = applyHunks(original.replace(/\r\n/g, '\n'), operation.hunks)
          if (!applied.ok) {
            outcome = { status: 'failed', operation: record, failure: hunkMismatch(target.displayPath, applied.failure), changes: [] }
            break
          }
          started = true
          const result = await ctx.fs.writeText(
            target,
            storedPatchText(original, applied.after),
            replaceIntent(intent),
            exec.signal,
            policy,
          )
          ctx.emit('fs/observed', target, { kind: 'present', version: result.version }, exec, 'edit')
          outcome = { status: 'completed', operation: record, changes: [{ path: ctx.fs.processPath(target), before: result.before, after: result.after }] }
          break
        }
        case 'delete': {
          const intent = await sourceIntent(ctx, exec, target, 'delete')
          started = true
          const result = await ctx.fs.deleteFile(target, intent, exec.signal, policy)
          ctx.emit('fs/observed', target, { kind: 'absent' }, exec, 'write')
          outcome = { status: 'completed', operation: record, changes: [{ path: ctx.fs.processPath(target), before: result.before, after: null }] }
          break
        }
        case 'move': {
          const expectedSource = await sourceIntent(ctx, exec, target, 'edit')
          failurePath = operation.destination.displayPath
          const expectedDestination = await destinationIntent(ctx, exec, operation.destination)
          const original = await ctx.fs.readText(target, exec.signal)
          if (original.includes('\0')) throw new FsError(`cannot patch "${target.displayPath}": binary file`, 'FS_NOT_TEXT')
          const applied = applyHunks(original.replace(/\r\n/g, '\n'), operation.hunks)
          if (!applied.ok) {
            outcome = { status: 'failed', operation: record, failure: hunkMismatch(target.displayPath, applied.failure), changes: [] }
            break
          }
          const content = storedPatchText(original, applied.after)
          started = true
          const result = await ctx.fs.moveFile(target, operation.destination, {
            content,
            ...(expectedSource === undefined ? {} : { expectedSource }),
            ...(expectedDestination === undefined ? {} : { expectedDestination }),
          }, exec.signal, policy)
          const changes = [{
            path: ctx.fs.processPath(operation.destination),
            before: result.destination.before,
            after: result.destination.after,
          }]
          ctx.emit('fs/observed', operation.destination, { kind: 'present', version: result.destination.version }, exec, 'write')
          if (result.sourceDeleted) {
            ctx.emit('fs/observed', target, { kind: 'absent' }, exec, 'write')
            outcome = {
              status: 'completed',
              operation: record,
              changes: [...changes, { path: ctx.fs.processPath(target), before: result.sourceBefore, after: null }],
            }
          } else {
            const error = new FsError(result.sourceFailure.message, result.sourceFailure.code)
            outcome = { status: 'failed', operation: record, failure: patchFailure(sandbox, policy, error, target.displayPath), changes }
          }
          break
        }
        /* v8 ignore start -- planned operations are only add, update, delete, and move. */
        default: unexpectedOperation(operation)
        /* v8 ignore stop */
      }
    } catch (error) {
      /* v8 ignore next -- filesystem methods reject with FsError; any other rejection is a programming defect. */
      if (!(error instanceof FsError)) throw error
      const failure = patchFailure(sandbox, policy, error, failurePath)
      const uncertain = started && (error.code === 'FS_ABORTED' || (error.code === 'FS_IO_ERROR' && !await unchanged(ctx, before)))
      outcome = uncertain
        ? { status: 'unknown', operation: record, failure: { ...failure, message: `${failure.message} — re-read the affected files before retrying` } }
        : { status: 'failed', operation: record, failure, changes: [] }
    }
    outcomes[index] = outcome
    if (outcome.status !== 'completed') { cancelled = exec.signal.aborted; break }
  }
  const affectedPaths = [...new Set(outcomes.flatMap(outcome => 'changes' in outcome ? outcome.changes.map(change => change.path) : []))]
  return { phase: 'commit', outcomes, affectedPaths, cancelled }
}
