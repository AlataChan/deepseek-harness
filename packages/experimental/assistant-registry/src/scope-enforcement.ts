/**
 * Capability and scope enforcement for persistent assistants and saved teams.
 * Computes effective permissions via strict policy intersection and installs guards.
 * @module @deepseek-ai/dsh-experimental-assistant-registry/scope-enforcement
 */

import { realpathSync } from 'node:fs'
import { isAbsolute, resolve as resolvePath, relative } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { CapabilityPolicy } from './types.ts'

/** Derived effective capabilities computed from intersected policies. */
export interface EffectiveCapabilities {
  readonly allowedTools: ReadonlySet<string> | undefined
  readonly disallowedTools: ReadonlySet<string>
  readonly allowedPaths: readonly string[] | undefined
  readonly allowTerminal: boolean
  readonly allowSubagents: boolean
  /**
   * Check whether one tool name is permitted under the effective policy.
   * @param toolName - candidate tool name.
   * @returns true if allowed, false if denied.
   */
  isToolPermitted(toolName: string): boolean
  /**
   * Check whether one filesystem path is within the allowed paths under the effective policy.
   * @param targetPath - candidate path (absolute, or relative to `baseDir`).
   * @param baseDir - the session working directory resolved against relative targets.
   * @returns true if allowed, false if denied.
   */
  isPathPermitted(targetPath: string, baseDir?: string): boolean
}

/** Error thrown when a capability or scope restriction is violated. */
export class ScopeAccessError extends Error {
  constructor(message: string, public readonly code: string = 'SCOPE_ACCESS_DENIED') {
    super(message)
    this.name = 'ScopeAccessError'
  }
}

/**
 * Resolve one path to its real filesystem location when it exists, otherwise its lexical absolute form.
 * @param path - candidate path.
 * @returns canonical absolute path.
 */
function canonicalizePath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolvePath(path)
  }
}

/**
 * Compute the strict intersection of deployment policy, profile policy, team grants, and seat grants.
 * Role or duty text can never widen effective permissions.
 * @param policies - list of capability policies in order from widest (deployment) to narrowest (seat).
 * @returns compiled effective capabilities.
 */
export function intersectCapabilities(
  ...policies: readonly (CapabilityPolicy | undefined)[]
): EffectiveCapabilities {
  const definedPolicies = policies.filter((p): p is CapabilityPolicy => p !== undefined)

  let combinedAllowed: Set<string> | undefined = undefined
  const combinedDisallowed = new Set<string>()
  let combinedPaths: string[] | undefined = undefined
  let allowTerminal = true
  let allowSubagents = true

  for (const policy of definedPolicies) {
    if (policy.allowedTools !== undefined) {
      const currentSet = new Set(policy.allowedTools)
      if (combinedAllowed === undefined) {
        combinedAllowed = new Set(currentSet)
      } else {
        // Strict intersection: keep only tools present in both sets
        for (const tool of combinedAllowed) {
          if (!currentSet.has(tool)) combinedAllowed.delete(tool)
        }
      }
    }

    if (policy.disallowedTools !== undefined) {
      for (const tool of policy.disallowedTools) {
        combinedDisallowed.add(tool)
      }
    }

    if (policy.allowedPaths !== undefined) {
      if (combinedPaths === undefined) {
        combinedPaths = [...policy.allowedPaths]
      } else {
        // Intersect paths: keep narrower subpaths
        const intersected: string[] = []
        for (const candidate of policy.allowedPaths) {
          const resolved = resolvePath(candidate)
          if (combinedPaths.some((p) => {
            const rel = relative(resolvePath(p), resolved)
            return !rel.startsWith('..') && !rel.startsWith('/')
          })) {
            intersected.push(candidate)
          }
        }
        combinedPaths = intersected
      }
    }

    if (policy.allowTerminal === false) {
      allowTerminal = false
    }

    if (policy.allowSubagents === false) {
      allowSubagents = false
    }
  }

  // Any disallowed tool must be excluded from allowedTools
  if (combinedAllowed !== undefined) {
    for (const disallowed of combinedDisallowed) {
      combinedAllowed.delete(disallowed)
    }
  }

  // If allowTerminal is false, explicitly disallow terminal tools
  if (!allowTerminal) {
    combinedDisallowed.add('bash')
    combinedDisallowed.add('run_command')
    combinedDisallowed.add('terminal_exec')
    if (combinedAllowed !== undefined) {
      combinedAllowed.delete('bash')
      combinedAllowed.delete('run_command')
      combinedAllowed.delete('terminal_exec')
    }
  }

  // If allowSubagents is false, explicitly disallow subagent creation tools
  if (!allowSubagents) {
    combinedDisallowed.add('spawn_teammate')
    combinedDisallowed.add('subagent_start')
    if (combinedAllowed !== undefined) {
      combinedAllowed.delete('spawn_teammate')
      combinedAllowed.delete('subagent_start')
    }
  }

  const finalAllowed: ReadonlySet<string> | undefined = combinedAllowed !== undefined
    ? new Set(combinedAllowed)
    : undefined
  const finalDisallowed: ReadonlySet<string> = new Set(combinedDisallowed)
  const finalPaths = combinedPaths !== undefined ? Object.freeze([...combinedPaths]) : undefined

  return {
    allowedTools: finalAllowed,
    disallowedTools: finalDisallowed,
    allowedPaths: finalPaths,
    allowTerminal,
    allowSubagents,
    isToolPermitted(toolName: string): boolean {
      if (!allowTerminal && (toolName.startsWith('terminal_') || toolName === 'bash' || toolName === 'run_command' || toolName === 'exec_command')) {
        return false
      }
      if (finalDisallowed.has(toolName)) return false
      if (finalAllowed !== undefined) return finalAllowed.has(toolName)
      return true
    },
    isPathPermitted(targetPath: string, baseDir?: string): boolean {
      if (finalPaths === undefined) return true
      if (finalPaths.length === 0) return false
      // Canonicalize through the real filesystem when the target exists so symlinks and '..' cannot
      // escape the allowed roots; fall back to lexical resolution for not-yet-created paths.
      const absoluteTarget = isAbsolute(targetPath) || baseDir === undefined
        ? targetPath
        : resolvePath(baseDir, targetPath)
      const resolvedTarget = canonicalizePath(absoluteTarget)
      return finalPaths.some((allowed) => {
        const resolvedAllowed = canonicalizePath(allowed)
        const rel = relative(resolvedAllowed, resolvedTarget)
        return !rel.startsWith('..') && !rel.startsWith('/')
      })
    },
  }
}

/** Extract target filesystem path from untyped tool arguments without type assertions. */
function extractTargetPath(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  if ('file_path' in args && typeof args.file_path === 'string') return args.file_path
  if ('filePath' in args && typeof args.filePath === 'string') return args.filePath
  if ('path' in args && typeof args.path === 'string') return args.path
  if ('targetPath' in args && typeof args.targetPath === 'string') return args.targetPath
  if ('target_path' in args && typeof args.target_path === 'string') return args.target_path
  return undefined
}

/**
 * Extract every referenced session id from untyped tool arguments without type assertions.
 * @param args - untyped tool invocation arguments.
 * @returns list of extracted session identifiers.
 */
export function extractTargetSessionIds(args: unknown): readonly string[] {
  if (typeof args !== 'object' || args === null) return []
  const found: string[] = []
  if ('session_id' in args && typeof args.session_id === 'string' && args.session_id !== '') {
    found.push(args.session_id)
  }
  for (const key of ['session_ids', 'parent_session_ids'] as const) {
    const value: unknown = key === 'session_ids'
      ? ('session_ids' in args ? args.session_ids : undefined)
      : ('parent_session_ids' in args ? args.parent_session_ids : undefined)
    if (!Array.isArray(value)) continue
    for (const entry of value) {
      if (typeof entry === 'string' && entry !== '') found.push(entry)
    }
  }
  return found
}

/** Enforcement callbacks supplied by the owning service for one guarded agent. */
export interface ScopeEnforcementOptions {
  /** Caller session id used for source authorization. */
  readonly callerSessionId: SessionId
  /**
   * Authorize one session-history target for this caller.
   * `undefined` means the caller has no session scope (unrestricted).
   * @param caller - caller session id.
   * @param target - referenced session id.
   * @returns true when permitted, false when denied, undefined when unrestricted.
   */
  readonly authorizeSessionSource?: ((caller: SessionId, target: string) => boolean | undefined) | undefined
}

/**
 * Install scope enforcement guards on an active live Agent.
 * Rejects execution of disallowed tools, out-of-scope paths, and session-history targets
 * outside the caller's permitted session scope.
 * @param agent - exact live Agent.
 * @param effectiveOrGetter - effective capability policy to enforce or dynamic getter.
 * @param options - caller identity and source authorization callbacks.
 * @returns disposer for the registered guards.
 */
export function installScopeEnforcement(
  agent: Agent,
  effectiveOrGetter: EffectiveCapabilities | (() => EffectiveCapabilities),
  options?: ScopeEnforcementOptions,
): () => void {
  const tools = agent.ctx.get('tools')
  if (tools === undefined) return () => {}

  return tools.guard((exec: ToolExecution) => {
    const effective = typeof effectiveOrGetter === 'function' ? effectiveOrGetter() : effectiveOrGetter
    // 1. Tool name enforcement
    if (!effective.isToolPermitted(exec.name)) {
      return `Tool "${exec.name}" is not permitted under the effective capability policy`
    }

    // 2. Path enforcement for filesystem tools
    if (effective.allowedPaths !== undefined) {
      const targetPath = extractTargetPath(exec.arguments)
      if (targetPath !== undefined && !effective.isPathPermitted(targetPath, agent.session.header.cwd)) {
        return `Path "${targetPath}" is outside allowed paths under the effective capability policy`
      }
    }

    // 3. Session-source enforcement for history tools: the caller's binding decides which sessions are readable.
    if (options?.authorizeSessionSource !== undefined) {
      for (const target of extractTargetSessionIds(exec.arguments)) {
        if (options.authorizeSessionSource(options.callerSessionId, target) === false) {
          return `Session "${target}" is outside the permitted session scope for this assistant`
        }
      }
    }

    return undefined
  })
}

/**
 * Assert that a calling session is authorized to access a given scope.
 * Prevents cross-scope leakage across teams and private conversations.
 * @param callerSessionId - candidate session id.
 * @param permittedSessionIds - session ids authorized for this scope.
 * @param scopeDescription - description of the target scope.
 */
export function assertScopeAccess(
  callerSessionId: SessionId,
  permittedSessionIds: readonly SessionId[],
  scopeDescription: string,
): void {
  if (!permittedSessionIds.includes(callerSessionId)) {
    throw new ScopeAccessError(
      `Session "${callerSessionId}" is not permitted to access ${scopeDescription}`,
      'CROSS_SCOPE_ACCESS_DENIED',
    )
  }
}
