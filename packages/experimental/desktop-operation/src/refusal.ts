/**
 * Permission and stale-ref classification for desktop operation.
 * Neither path edits TCC or starts a permission guide.
 * Sentences come from {@link desktopOperationCopy}.
 * @module @deepseek-ai/dsh-experimental-desktop-operation/refusal
 */

import { desktopOperationCopy, type DesktopOperationLocale } from './copy.ts'
import { isDesktopOperationPlatform } from './platform.ts'

/**
 * Whether a native permission state is a denial.
 * `granted` and `unknown` are not denials.
 * @param state - permission `state` string from `agent-desktop status`.
 * @returns true for every other state, including a synthetic `denied`.
 */
export function isPermissionDenial(state: string): boolean {
  return state !== 'granted' && state !== 'unknown'
}

/**
 * Whether a tool error is the skill's stale-ref class.
 * @param error - tool error object. Only `code` is read.
 * @returns true when `code` is `STALE_REF`.
 */
export function isStaleRef(error: { readonly code?: string }): boolean {
  return error.code === 'STALE_REF'
}

/**
 * Description the existing preset card shows for this host.
 * @param options - platform support, permission denial, and the packaged fallback sentence.
 * @returns the status sentence, or the fallback when the host can run.
 */
export function publishedDescription(options: {
  readonly supported: boolean
  readonly permissionDenied: boolean
  readonly fallback: string
  readonly locale?: DesktopOperationLocale
}): string {
  const copy = desktopOperationCopy[options.locale ?? 'zh']
  if (!options.supported) return copy.platformUnsupported
  if (options.permissionDenied) return copy.permissionDenied
  return options.fallback
}

/**
 * Roster description for one host tuple and a status probe.
 * The default locale is Chinese because the preset card shows this string verbatim.
 * @param input - platform tuple, packaged fallback, and probe result.
 * @returns the sentence `register` publishes.
 */
export function desktopOperationDescription(input: {
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly fallback: string
  readonly probe: 'ready' | 'denied' | 'unavailable'
  readonly locale?: DesktopOperationLocale
}): string {
  const copy = desktopOperationCopy[input.locale ?? 'zh']
  if (!isDesktopOperationPlatform(input.platform, input.arch)) return copy.platformUnsupported
  if (input.probe === 'unavailable') return copy.statusUnavailable
  if (input.probe === 'denied') return copy.permissionDenied
  return input.fallback
}

/** A status payload that parsed as JSON but is not a permission map. */
export class StatusPayloadError extends Error {
  /**
   * @param message - stable misclassification sentence.
   */
  constructor(message = 'desktop-operation: status payload is missing a permission map') {
    super(message)
    this.name = 'StatusPayloadError'
  }
}

/**
 * Classify one status payload.
 * Empty stdout, non-JSON, an empty `data.permissions` map, and JSON without a well-formed map are unavailable.
 * `granted` and `unknown` are not denials. Any other string state is a denial.
 * @param stdout - status stdout, or undefined when the process did not finish with output.
 * @returns `ready` only for a non-empty permission map whose states are all `granted` or `unknown`.
 * @throws {Error} when classification fails for a reason other than syntax or payload shape.
 */
export function statusProbe(stdout: string | undefined): 'ready' | 'denied' | 'unavailable' {
  if (stdout === undefined || stdout.trim() === '') return 'unavailable'
  try {
    return permissionDeniedFromStatus(stdout) ? 'denied' : 'ready'
  } catch (error: unknown) {
    if (error instanceof SyntaxError || error instanceof StatusPayloadError) return 'unavailable'
    throw error
  }
}

/**
 * Read permission states from one `agent-desktop status` stdout payload.
 * @param stdout - the command's stdout.
 * @returns true when any permission state is a denial.
 * @throws {SyntaxError} when the payload is not JSON.
 * @throws {StatusPayloadError} when JSON has no well-formed `data.permissions` map.
 */
export function permissionDeniedFromStatus(stdout: string): boolean {
  const parsed: unknown = JSON.parse(stdout)
  const states = permissionStates(parsed)
  if (states === undefined) throw new StatusPayloadError()
  return states.some(state => isPermissionDenial(state))
}

function permissionStates(parsed: unknown): readonly string[] | undefined {
  if (typeof parsed !== 'object' || parsed === null || !('data' in parsed)) return undefined
  const data = parsed.data
  if (typeof data !== 'object' || data === null || !('permissions' in data)) return undefined
  const permissions = data.permissions
  if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) return undefined
  const states: string[] = []
  const values: unknown[] = Object.values(permissions)
  for (const value of values) {
    if (typeof value !== 'object' || value === null || !('state' in value) || typeof value.state !== 'string') return undefined
    states.push(value.state)
  }
  if (states.length === 0) return undefined
  return states
}
