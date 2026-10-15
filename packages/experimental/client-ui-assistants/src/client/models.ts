/** Served model options and the provider:model encoding shared by assistant pickers. */

/** One served model the assistant pickers may select. */
export interface AssistantModelOption {
  readonly id: string
  readonly name: string
  readonly provider: string
}

/** One provider/model route picked from the served catalog. */
export interface ModelRoute {
  readonly provider: string
  readonly model: string
}

/**
 * Encode one model route as a `<select>` value.
 * @param selection - route stored on a profile, conversation, or seat.
 * @returns `provider:model`, or the empty string when absent.
 */
export function modelRouteValue(selection: ModelRoute | undefined): string {
  if (selection === undefined) return ''
  return `${selection.provider}:${selection.model}`
}

/**
 * Decode one `<select>` value into a model route.
 * @param value - `provider:model`, or the empty string for no selection.
 * @returns the route, or undefined for an empty value.
 */
export function parseModelRoute(value: string): ModelRoute | undefined {
  if (value === '') return undefined
  const cut = value.indexOf(':')
  if (cut <= 0 || cut === value.length - 1) return undefined
  const provider = value.slice(0, cut)
  const model = value.slice(cut + 1)
  return { provider, model }
}
