/** Read-only simulation of patch effects; no internal read establishes model observation. */
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsTarget, FsTargetKey } from '@deepseek-ai/dsh-fs'
import { applyHunks } from '@deepseek-ai/dsh-fs-patch'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { FsSandboxController } from '../sandbox.ts'
import { sessionResolveOptions } from '../session-cwd.ts'
import { destinationIntent, hunkMismatch, patchFailure, sourceIntent } from './plan.ts'
import type { PatchFailure, PatchRefusal, PlannedOperation } from './types.ts'
import { unexpectedOperation } from './types.ts'

interface SimulatedFile {
  exists: boolean
  info: FsInfo | undefined
  content?: string
  touched: boolean
}

class Preflight {
  private failurePath = ''
  private readonly states = new Map<FsTargetKey, SimulatedFile>()

  constructor(
    private readonly ctx: Context, private readonly sandbox: FsSandboxController, private readonly exec: ToolExecution,
    private readonly policy: SandboxExecutionPolicy | undefined,
  ) {}

  private async state(target: FsTarget): Promise<SimulatedFile> {
    const known = this.states.get(target.targetKey)
    if (known) return known
    const info = await this.ctx.fs.stat(target, this.exec.signal)
    const state = { exists: info !== undefined, info, touched: false }
    this.states.set(target.targetKey, state)
    return state
  }

  private regular(state: SimulatedFile, target: FsTarget): void {
    if (state.info !== undefined && state.info.type !== 'file') {
      throw new FsError(`cannot modify "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
    }
  }

  private async source(state: SimulatedFile, target: FsTarget, kind: 'delete' | 'edit' | 'move'): Promise<void> {
    const intent = state.touched
      ? undefined
      : await sourceIntent(this.ctx, this.exec, target, kind === 'delete' ? 'delete' : 'edit')
    if (!state.exists) throw new FsError(`cannot ${kind} "${target.displayPath}": not found`, 'FS_NOT_FOUND')
    this.regular(state, target)
    if (intent !== undefined && intent.version !== state.info?.version) {
      throw new FsError(`cannot ${kind} "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
    }
  }

  private async destination(state: SimulatedFile, target: FsTarget): Promise<void> {
    const intent = state.touched ? undefined : await destinationIntent(this.ctx, this.exec, target)
    this.regular(state, target)
    if (intent?.kind === 'createIfAbsent' && state.exists) {
      throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, 'FS_NOT_OBSERVED')
    }
    if (intent?.kind === 'replaceIfVersion' && (!state.exists || state.info?.version !== intent.version)) {
      throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
    }
  }

  private async symlinkPath(path: string, verb: string, displayPath: string): Promise<PatchFailure | undefined> {
    const options = await sessionResolveOptions(this.ctx, this.exec)
    const info = await this.ctx.fs.lstat(
      path,
      options.cwd === undefined ? undefined : { cwd: options.cwd },
      options.signal,
    )
    if (info?.type !== 'symlink') return undefined
    return {
      code: 'PATCH_SYMLINK_SOURCE',
      message: `cannot ${verb} "${displayPath}": path is a symbolic link — operate on its target path instead`,
    }
  }

  private async content(state: SimulatedFile, target: FsTarget): Promise<string> {
    if (state.content === undefined) {
      const text = await this.ctx.fs.readText(target, this.exec.signal)
      if (text.includes('\0')) throw new FsError(`cannot patch "${target.displayPath}": binary file`, 'FS_NOT_TEXT')
      state.content = text.replace(/\r\n/g, '\n')
    }
    return state.content
  }

  private publish(target: FsTarget, content?: string): void {
    this.states.set(target.targetKey, {
      exists: content !== undefined, info: undefined, touched: true,
      ...(content === undefined ? {} : { content }),
    })
  }

  /** Simulate one operation; a filesystem refusal becomes the operation's failure. */
  async check(operation: PlannedOperation): Promise<PatchFailure | undefined> {
    this.failurePath = operation.target.displayPath
    try { return await this.simulate(operation) } catch (error) {
      /* v8 ignore next -- simulation rejects with FsError; any other rejection is a programming defect. */
      if (!(error instanceof FsError)) throw error
      return patchFailure(this.sandbox, this.policy, error, this.failurePath)
    }
  }

  private async simulate(operation: PlannedOperation): Promise<PatchFailure | undefined> {
    if (operation.kind === 'move' && operation.target.targetKey === operation.destination.targetKey) {
      return {
        code: 'FS_SAME_TARGET',
        message: `cannot move "${operation.target.displayPath}" to itself`,
      }
    }
    if (operation.kind === 'delete' || operation.kind === 'move') {
      const linked = await this.symlinkPath(operation.rawPath, operation.kind, operation.target.displayPath)
      if (linked !== undefined) return linked
    }
    if (operation.kind === 'add' || operation.kind === 'move') {
      const path = operation.kind === 'add' ? operation.rawPath : operation.rawDestination
      const display = operation.kind === 'add' ? operation.target.displayPath : operation.destination.displayPath
      const linked = await this.symlinkPath(path, operation.kind, display)
      if (linked !== undefined) return linked
    }
    const state = await this.state(operation.target)
    switch (operation.kind) {
      case 'add':
        await this.destination(state, operation.target)
        this.publish(operation.target, operation.content)
        return
      case 'delete':
        await this.source(state, operation.target, 'delete')
        this.publish(operation.target)
        return
      case 'update':
      case 'move': {
        await this.source(state, operation.target, operation.kind === 'move' ? 'move' : 'edit')
        if (operation.kind === 'move') {
          this.failurePath = operation.destination.displayPath
          await this.destination(await this.state(operation.destination), operation.destination)
          this.failurePath = operation.target.displayPath
        }
        const result = applyHunks(await this.content(state, operation.target), operation.hunks)
        if (!result.ok) return hunkMismatch(operation.target.displayPath, result.failure)
        if (operation.kind === 'move') {
          this.publish(operation.destination, result.after)
          this.publish(operation.target)
        } else this.publish(operation.target, result.after)
        return
      }
      /* v8 ignore start -- planned operations are only add, update, delete, and move. */
      default: return unexpectedOperation(operation)
      /* v8 ignore stop */
    }
  }
}

/**
 * Collect every independent preflight refusal while simulating only admitted operations.
 * Sandbox containment is the provider's decision at commit, as for write and edit.
 * @param ctx - filesystem service owner; reads never emit observations.
 * @param sandbox - model-facing denial mapper.
 * @param exec - observation actor and cancellation signal.
 * @param policy - resolved confinement policy used to label refusals.
 * @param operations - complete resolved operation plan.
 * @returns refused operations in patch order; any refusal forbids the commit phase.
 */
export async function preflightPatch(
  ctx: Context, sandbox: FsSandboxController, exec: ToolExecution, policy: SandboxExecutionPolicy | undefined,
  operations: readonly PlannedOperation[],
): Promise<PatchRefusal[]> {
  const preflight = new Preflight(ctx, sandbox, exec, policy)
  const refusals: PatchRefusal[] = []
  for (const operation of operations) {
    const failure = await preflight.check(operation)
    if (failure !== undefined) refusals.push({ operation: operation.record, failure })
  }
  return refusals
}
