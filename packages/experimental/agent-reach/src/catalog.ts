import { encodeActionParameters } from './argv.ts'
/**
 * Upstream Agent-Reach channel catalog and action/route validation.
 *
 * Enforces channel enablement, experimental gates, side-effect classifications,
 * explicit sessionAccessRoutes tuples (no wildcards), strict parameter validation,
 * and safe argv construction based on upstream's required-positional conventions.
 *
 * @module @deepseek-ai/dsh-experimental-agent-reach/catalog
 */

import * as path from 'node:path'
import rawContract from '../runtime-contract.json' with { type: 'json' }

/** Session or browser mutation requiring an exact route opt-in. */
export type SideEffect =
  | 'connected-browser-discovery'
  | 'cookie-import'
  | 'native-credential-write'
  | 'browser-launch'

/** Closed effect vocabulary accepted from the frozen catalog. */
export const KNOWN_SIDE_EFFECTS: ReadonlySet<string> = new Set<SideEffect>([
  'connected-browser-discovery',
  'cookie-import',
  'native-credential-write',
  'browser-launch',
])

/** One upstream CLI parameter and its declared primitive type. */
export interface ParamDefinition {
  /** Parameter identifier corresponding to upstream argparse name. */
  readonly name: string
  /** Parameter primitive type. */
  readonly type: 'string' | 'number' | 'boolean'
  /** Whether upstream argparse declares this as required (positional). */
  readonly required: boolean
  /** Default value for optional parameters. */
  readonly default?: string | number | boolean | undefined
  /** Usage guidance. */
  readonly help: string
}

/** A reachable backend and all classified session effects. */
export interface BackendDefinition {
  /** Upstream backend identifier (e.g., 'bili-cli', 'yt-dlp', 'opencli'). */
  readonly name: string
  /** Classified side-effects incurred when invoking this backend. */
  readonly sideEffects: readonly SideEffect[]
}

/** One read action, its argv parameters and fallback backends. */
export interface ActionDefinition {
  /** Action identifier (e.g., 'search', 'read', 'subtitle'). */
  readonly name: string
  /** Action description. */
  readonly help: string
  /** Upstream CLI usage string. */
  readonly usage?: string | undefined
  /** Parameter declarations. */
  readonly params: readonly ParamDefinition[]
  /** Backends capable of handling this action, in fallback priority order. */
  readonly backends: readonly BackendDefinition[]
  /** Supported public web domains if applicable. */
  readonly publicWeb?: readonly string[] | undefined
}

/** Platform maturity and supported read actions. */
export interface ChannelDefinition {
  /** Channel identifier (e.g., 'bilibili', 'youtube', 'v2ex'). */
  readonly name: string
  /** Human-readable localized description. */
  readonly description: string
  /** Channel maturity level. */
  readonly level: 'default' | 'optional' | 'experimental'
  /** Supported actions under this channel. */
  readonly actions: readonly ActionDefinition[]
}

/** Reviewed source identity and frozen CLI catalog. */
export interface RuntimeContract {
  readonly upstream: {
    readonly repository: string
    readonly reviewedRevision: string
    readonly version: string
    readonly schemaVersion: number
  }
  readonly defaultConfiguration: AgentReachConfig
  readonly managementCommands: readonly string[]
  readonly excludedActions: readonly string[]
  readonly channels: readonly ChannelDefinition[]
}

/** Deployment choices validated before plugin activation. */
export interface AgentReachConfig {
  /** Absolute administrator-qualified CLI launcher; ambient discovery is disabled. */
  readonly runtimeOverride?: string | undefined
  /** Platform names exposed to ordinary read queries. */
  readonly enabledChannels?: readonly string[] | undefined
  /** Exact channel/action/backend tuples permitted to access account sessions. */
  readonly sessionAccessRoutes?: readonly string[] | undefined
  /** Permit explicitly enabled experimental platforms. */
  readonly allowExperimentalChannels?: boolean | undefined
  /** Overall prerequisite installation deadline in milliseconds. */
  readonly setupTimeoutMs?: number | undefined
  /** Default per-query deadline in milliseconds. */
  readonly queryTimeoutMs?: number | undefined
  /** Maximum simultaneously active query process ranges. */
  readonly maxConcurrentQueries?: number | undefined
  /** Maximum captured CLI JSON bytes before termination. */
  readonly maxStdoutBytes?: number | undefined
  /** Maximum retained diagnostic bytes. */
  readonly maxStderrBytes?: number | undefined
  /** Aggregate budget for variable strings exposed in a result. */
  readonly maxOutputChars?: number | undefined
  /** Maximum public items retained from a query. */
  readonly maxItems?: number | undefined
  /** Grace period before forced process-range termination in milliseconds. */
  readonly terminateGraceMs?: number | undefined
}

/** Configuration with canonical deployment defaults applied once by its owner. */
export type ResolvedAgentReachConfig = {
  readonly [K in Exclude<keyof AgentReachConfig, 'runtimeOverride'>]-?: Exclude<AgentReachConfig[K], undefined>
} & Pick<AgentReachConfig, 'runtimeOverride'>

/**
 * Resolve omitted deployment values without overwriting defaults with explicit undefined.
 * @param config - Validated partial deployment settings.
 * @returns Complete limits and channel policy, with an optional administrator launcher.
 */
export function resolveConfig(config: AgentReachConfig): ResolvedAgentReachConfig {
  const defaults = rawContract.defaultConfiguration
  const resolved = { ...defaults, ...(config.runtimeOverride === undefined ? {} : { runtimeOverride: config.runtimeOverride }) }
  for (const key of Object.keys(defaults) as Array<keyof typeof defaults>) {
    const value = config[key]
    if (value !== undefined) Object.assign(resolved, { [key]: value })
  }
  resolved.enabledChannels = [...resolved.enabledChannels]
  resolved.sessionAccessRoutes = [...resolved.sessionAccessRoutes]
  return resolved
}

/**
 * Validate and decode a raw JSON object into a strongly-typed RuntimeContract.
 * Fails closed on any unknown side effect, missing required property, or malformed type.
 *
 * @param raw - untrusted JSON data
 * @returns validated RuntimeContract
 * @throws Error if validation fails
 */
export function decodeRuntimeContract(raw: unknown): RuntimeContract {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Contract root must be an object')
  }

  const obj = raw as Record<string, unknown>
  const upstream = obj.upstream as Record<string, unknown> | undefined
  if (!upstream || typeof upstream.version !== 'string' || typeof upstream.reviewedRevision !== 'string' || upstream.schemaVersion !== 1) {
    throw new Error('Contract upstream metadata invalid or unsupported schemaVersion')
  }

  const channelsRaw = obj.channels
  if (!Array.isArray(channelsRaw)) {
    throw new Error('Contract channels must be an array')
  }

  const channels: ChannelDefinition[] = []
  for (const chItem of channelsRaw) {
    if (typeof chItem !== 'object' || chItem === null) {
      throw new Error('Channel entry must be an object')
    }
    const ch = chItem as Record<string, unknown>
    if (typeof ch.name !== 'string' || typeof ch.description !== 'string' || !['default', 'optional', 'experimental'].includes(String(ch.level))) {
      throw new Error(`Invalid channel header for ${String(ch.name)}`)
    }

    const actionsRaw = ch.actions
    if (!Array.isArray(actionsRaw)) {
      throw new Error(`Actions for channel ${ch.name} must be an array`)
    }

    const actions: ActionDefinition[] = []
    for (const actItem of actionsRaw) {
      if (typeof actItem !== 'object' || actItem === null) {
        throw new Error(`Action entry in channel ${ch.name} must be an object`)
      }
      const act = actItem as Record<string, unknown>
      if (typeof act.name !== 'string' || typeof act.help !== 'string') {
        throw new Error(`Invalid action header in channel ${ch.name}`)
      }

      const paramsRaw = act.params
      if (!Array.isArray(paramsRaw)) {
        throw new Error(`Params for action ${ch.name}/${act.name} must be an array`)
      }
      const params: ParamDefinition[] = []
      for (const pItem of paramsRaw) {
        if (typeof pItem !== 'object' || pItem === null) {
          throw new Error(`Param in ${ch.name}/${act.name} must be an object`)
        }
        const p = pItem as Record<string, unknown>
        if (typeof p.name !== 'string' || typeof p.help !== 'string' || typeof p.required !== 'boolean' || !['string', 'number', 'boolean'].includes(String(p.type))) {
          throw new Error(`Invalid param definition in ${ch.name}/${act.name}`)
        }
        params.push({
          name: p.name,
          type: p.type as 'string' | 'number' | 'boolean',
          required: p.required,
          default: p.default as string | number | boolean | undefined,
          help: p.help,
        })
      }

      const backendsRaw = act.backends
      if (!Array.isArray(backendsRaw)) {
        throw new Error(`Backends for action ${ch.name}/${act.name} must be an array`)
      }
      const backends: BackendDefinition[] = []
      for (const bItem of backendsRaw) {
        if (typeof bItem !== 'object' || bItem === null) {
          throw new Error(`Backend in ${ch.name}/${act.name} must be an object`)
        }
        const b = bItem as Record<string, unknown>
        if (typeof b.name !== 'string' || !Array.isArray(b.sideEffects)) {
          throw new Error(`Invalid backend definition in ${ch.name}/${act.name}`)
        }
        const sideEffects: SideEffect[] = []
        for (const eff of b.sideEffects) {
          if (typeof eff !== 'string' || !KNOWN_SIDE_EFFECTS.has(eff)) {
            throw new Error(`Unknown or invalid side effect "${String(eff)}" in ${ch.name}/${act.name}/${b.name}`)
          }
          sideEffects.push(eff as SideEffect)
        }
        backends.push({
          name: b.name,
          sideEffects,
        })
      }

      actions.push({
        name: act.name,
        help: act.help,
        usage: typeof act.usage === 'string' ? act.usage : undefined,
        params,
        backends,
        publicWeb: Array.isArray(act.publicWeb) ? act.publicWeb.map(String) : undefined,
      })
    }

    channels.push({
      name: ch.name,
      description: ch.description,
      level: ch.level as 'default' | 'optional' | 'experimental',
      actions,
    })
  }

  const defaultCfg = (obj.defaultConfiguration || {}) as AgentReachConfig
  const managementCommands = Array.isArray(obj.managementCommands) ? obj.managementCommands.map(String) : []
  const excludedActions = Array.isArray(obj.excludedActions) ? obj.excludedActions.map(String) : []

  return {
    upstream: {
      repository: String(upstream.repository),
      reviewedRevision: upstream.reviewedRevision,
      version: upstream.version,
      schemaVersion: upstream.schemaVersion,
    },
    defaultConfiguration: defaultCfg,
    managementCommands,
    excludedActions,
    channels,
  }
}

/** Decoded checked-in catalog; unknown effects fail module loading. */
export const RUNTIME_CONTRACT: RuntimeContract = decodeRuntimeContract(rawContract)

/** Exact channel/action/backend permission identifier. */
export type RouteTuple = `${string}/${string}/${string}`

/** Resolved action and every reachable effectful fallback. */
export interface RouteValidationSuccess {
  readonly ok: true
  readonly channel: ChannelDefinition
  readonly action: ActionDefinition
  readonly selectedBackend: BackendDefinition
  readonly reachableBackends: readonly BackendDefinition[]
  readonly requiredEffects: readonly SideEffect[]
}

/** A route rejected before executable resolution. */
export interface RouteValidationFailure {
  readonly ok: false
  readonly code:
    | 'UNKNOWN_CHANNEL'
    | 'UNKNOWN_ACTION'
    | 'UNKNOWN_BACKEND'
    | 'CHANNEL_DISABLED'
    | 'EXPERIMENTAL_CHANNEL_DISABLED'
    | 'ACTION_EXCLUDED'
    | 'SESSION_ROUTE_FORBIDDEN'
    | 'INVALID_CONFIG'
  readonly message: string
}

/** Either a complete allowed route or an explicit refusal. */
export type RouteValidationResult = RouteValidationSuccess | RouteValidationFailure

/**
 * Validate configuration fields to reject wildcards, invalid types, or out-of-range bounds.
 *
 * @param config - AgentReach configuration to inspect
 * @returns validity result and diagnostic error if invalid
 */
export function validateConfig(config: AgentReachConfig): { valid: true; error?: undefined } | { valid: false; error: string } {
  if (config.runtimeOverride !== undefined) {
    if (typeof config.runtimeOverride !== 'string') {
      return { valid: false, error: 'runtimeOverride must be a string' }
    }
    if (!path.isAbsolute(config.runtimeOverride)) {
      return { valid: false, error: 'runtimeOverride must be an absolute path' }
    }
  }

  if (config.sessionAccessRoutes !== undefined) {
    if (!Array.isArray(config.sessionAccessRoutes)) {
      return { valid: false, error: 'sessionAccessRoutes must be an array of strings' }
    }
    for (const route of config.sessionAccessRoutes) {
      if (typeof route !== 'string' || route.includes('*') || route.includes('?')) {
        return {
          valid: false,
          error: `Invalid sessionAccessRoutes entry "${route}": wildcards are forbidden and route must be exact channel/action/backend tuple`,
        }
      }
      const parts = route.split('/')
      if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
        return {
          valid: false,
          error: `Invalid sessionAccessRoutes entry "${route}": wildcards are forbidden and route must be exact channel/action/backend tuple`,
        }
      }
      const ch = parts[0]
      const act = parts[1]
      const bk = parts[2]
      const channel = findChannel(ch)
      if (!channel) {
        return { valid: false, error: `Invalid sessionAccessRoutes entry "${route}": unknown channel "${ch}"` }
      }
      const action = findAction(channel, act)
      if (!action) {
        return { valid: false, error: `Invalid sessionAccessRoutes entry "${route}": unknown action "${act}"` }
      }
      const backend = action.backends.find(b => b.name === bk)
      if (!backend) {
        return { valid: false, error: `Invalid sessionAccessRoutes entry "${route}": unknown backend "${bk}"` }
      }
    }
  }

  if (config.enabledChannels !== undefined) {
    if (!Array.isArray(config.enabledChannels)) {
      return { valid: false, error: 'enabledChannels must be an array of strings' }
    }
    for (const ch of config.enabledChannels) {
      if (typeof ch !== 'string' || !findChannel(ch)) {
        return { valid: false, error: `Invalid enabledChannels entry: unknown channel "${String(ch)}"` }
      }
    }
  }

  if (config.allowExperimentalChannels !== undefined && typeof config.allowExperimentalChannels !== 'boolean') {
    return { valid: false, error: 'allowExperimentalChannels must be a boolean' }
  }

  const checkBound = (
    name: string, val: unknown, min: number, max: number,
  ): { valid: true; error?: undefined } | { valid: false; error: string } => {
    if (val === undefined) return { valid: true }
    if (typeof val !== 'number' || !Number.isInteger(val) || val < min || val > max) {
      return { valid: false, error: `${name} must be a finite integer between ${min} and ${max}, received: ${JSON.stringify(val)}` }
    }
    return { valid: true }
  }

  const queryCheck = checkBound('queryTimeoutMs', config.queryTimeoutMs, 1000, 600000)
  if (!queryCheck.valid) return queryCheck

  const setupCheck = checkBound('setupTimeoutMs', config.setupTimeoutMs, 1000, 3600000)
  if (!setupCheck.valid) return setupCheck

  const concCheck = checkBound('maxConcurrentQueries', config.maxConcurrentQueries, 1, 64)
  if (!concCheck.valid) return concCheck

  const stdoutCheck = checkBound('maxStdoutBytes', config.maxStdoutBytes, 1024, 10485760)
  if (!stdoutCheck.valid) return stdoutCheck

  const stderrCheck = checkBound('maxStderrBytes', config.maxStderrBytes, 1024, 1048576)
  if (!stderrCheck.valid) return stderrCheck

  const charsCheck = checkBound('maxOutputChars', config.maxOutputChars, 100, 1000000)
  if (!charsCheck.valid) return charsCheck

  const itemsCheck = checkBound('maxItems', config.maxItems, 1, 100)
  if (!itemsCheck.valid) return itemsCheck

  const graceCheck = checkBound('terminateGraceMs', config.terminateGraceMs, 100, 60000)
  if (!graceCheck.valid) return graceCheck

  return { valid: true }
}

/**
 * Locate a channel definition by case-insensitive name.
 *
 * @param channelName - name of channel to look up
 * @returns ChannelDefinition or undefined
 */
export function findChannel(channelName: string): ChannelDefinition | undefined {
  return RUNTIME_CONTRACT.channels.find(c => c.name.toLowerCase() === channelName.toLowerCase())
}

/**
 * Locate an action definition under a channel by case-insensitive name.
 *
 * @param channel - owning channel definition
 * @param actionName - name of action to look up
 * @returns ActionDefinition or undefined
 */
export function findAction(channel: ChannelDefinition, actionName: string): ActionDefinition | undefined {
  return channel.actions.find(a => a.name.toLowerCase() === actionName.toLowerCase())
}

/**
 * Validate a query route against channel enablement, experimental permissions,
 * and classified browser/session side effects.
 *
 * @param channelName - requested channel
 * @param actionName - requested action
 * @param declaredBackend - optional user/caller backend preference
 * @param config - active configuration
 * @returns RouteValidationResult indicating success or closed refusal
 */
export function validateRoute(
  channelName: string,
  actionName: string,
  declaredBackend?: string,
  config: AgentReachConfig = RUNTIME_CONTRACT.defaultConfiguration,
): RouteValidationResult {
  const configCheck = validateConfig(config)
  if (!configCheck.valid) {
    return {
      ok: false,
      code: 'INVALID_CONFIG',
      message: configCheck.error,
    }
  }

  if (RUNTIME_CONTRACT.excludedActions.includes(actionName.toLowerCase())) {
    return {
      ok: false,
      code: 'ACTION_EXCLUDED',
      message: `Action "${actionName}" is excluded from Agent-Reach execution`,
    }
  }

  if (RUNTIME_CONTRACT.managementCommands.includes(actionName.toLowerCase())
    || RUNTIME_CONTRACT.managementCommands.includes(channelName.toLowerCase())) {
    return {
      ok: false,
      code: 'ACTION_EXCLUDED',
      message: `Management operation "${channelName}/${actionName}" cannot be invoked as a query route`,
    }
  }

  const channel = findChannel(channelName)
  if (!channel) {
    return {
      ok: false,
      code: 'UNKNOWN_CHANNEL',
      message: `Unknown channel "${channelName}"`,
    }
  }

  const enabledChannels = config.enabledChannels ?? RUNTIME_CONTRACT.defaultConfiguration.enabledChannels ?? []
  if (!enabledChannels.map(c => c.toLowerCase()).includes(channel.name.toLowerCase())) {
    return {
      ok: false,
      code: 'CHANNEL_DISABLED',
      message: `Channel "${channel.name}" is not enabled in plugin configuration`,
    }
  }

  if (channel.level === 'experimental' && !config.allowExperimentalChannels) {
    return {
      ok: false,
      code: 'EXPERIMENTAL_CHANNEL_DISABLED',
      message: `Channel "${channel.name}" is experimental and allowExperimentalChannels is false`,
    }
  }

  const action = findAction(channel, actionName)
  if (!action) {
    return {
      ok: false,
      code: 'UNKNOWN_ACTION',
      message: `Unknown action "${actionName}" for channel "${channel.name}"`,
    }
  }

  let reachableBackends: readonly BackendDefinition[]
  let selectedBackend: BackendDefinition

  if (declaredBackend) {
    const found = action.backends.find(b => b.name.toLowerCase() === declaredBackend.toLowerCase())
    if (!found) {
      return {
        ok: false,
        code: 'UNKNOWN_BACKEND',
        message: `Backend "${declaredBackend}" is not declared for action "${channel.name}/${action.name}"`,
      }
    }
    selectedBackend = found
    reachableBackends = [found]
  } else {
    const firstBackend = action.backends[0]
    if (!firstBackend) {
      return {
        ok: false,
        code: 'UNKNOWN_BACKEND',
        message: `No backends available for action "${channel.name}/${action.name}"`,
      }
    }
    selectedBackend = firstBackend
    reachableBackends = action.backends
  }

  const effectSet = new Set<SideEffect>()
  const permittedRoutes = new Set(config.sessionAccessRoutes ?? [])

  for (const backend of reachableBackends) {
    if (backend.sideEffects.length > 0) {
      const routeTuple: RouteTuple = `${channel.name}/${action.name}/${backend.name}`
      if (!permittedRoutes.has(routeTuple)) {
        return {
          ok: false,
          code: 'SESSION_ROUTE_FORBIDDEN',
          message: `Route "${routeTuple}" has classified side-effects (${backend.sideEffects.join(
            ', ',
          )}) but is not permitted in sessionAccessRoutes`,
        }
      }
      for (const eff of backend.sideEffects) {
        effectSet.add(eff)
      }
    }
  }

  return {
    ok: true,
    channel,
    action,
    selectedBackend,
    reachableBackends,
    requiredEffects: Array.from(effectSet),
  }
}

/** Typed request for fixed-argv construction; arbitrary argv is excluded. */
export interface BuildArgvOptions {
  readonly channel: string
  readonly action: string
  readonly params: Record<string, unknown>
  readonly backend?: string
  readonly timeoutSeconds?: number
}

/**
 * Build a safe argv array: named flags before `--`, positional values after `--`.
 *
 * Rules:
 * - Reject any unrecognized parameter keys.
 * - Required parameters are strictly positional and emitted in catalog order after `--`.
 * - Optional parameters are emitted as `--name <value>` flags before `--`.
 * - String parameters reject non-string values.
 * - Number parameters reject non-numbers, booleans, NaN, Infinity, and non-integers when integer bounded.
 * - Boolean parameters reject non-boolean types.
 * - Positional arguments after `--` safely preserve flag-looking inputs (e.g. queries starting with `-`).
 *
 * @param options - route and parameter options
 * @returns argv array or validation failure
 */
export function buildSafeArgv(options: BuildArgvOptions): { ok: true; argv: string[] } | { ok: false; error: string } {
  const { channel, action, params, backend, timeoutSeconds } = options
  const ch = findChannel(channel)
  if (!ch) return { ok: false, error: `Unknown channel "${channel}"` }
  const act = findAction(ch, action)
  if (!act) return { ok: false, error: `Unknown action "${action}"` }

  const knownParamNames = new Set(act.params.map(p => p.name))
  for (const key of Object.keys(params)) {
    if (!knownParamNames.has(key)) {
      return { ok: false, error: `Unrecognized parameter "${key}" for action "${ch.name}/${act.name}"` }
    }
  }

  const flags: string[] = []
  const positionals: string[] = []

  if (backend) {
    flags.push('--backend', backend)
  }
  if (timeoutSeconds !== undefined) {
    if (typeof timeoutSeconds !== 'number' || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      return { ok: false, error: `timeoutSeconds must be a positive finite number: ${String(timeoutSeconds)}` }
    }
    flags.push('--timeout', String(timeoutSeconds))
  }

  const encoded=encodeActionParameters(act.params,params)
  if(!encoded.ok)return encoded
  flags.push(...encoded.flags)
  positionals.push(...encoded.positionals)

  const argv = [ch.name, act.name, ...flags]
  if (positionals.length > 0) {
    argv.push('--', ...positionals)
  }

  return { ok: true, argv }
}
