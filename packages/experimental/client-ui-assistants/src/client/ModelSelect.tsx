import type { ReactElement } from 'react'
import type { AssistantModelOption } from './models.ts'
import { parseModelRoute } from './models.ts'
import type { AssistantLocaleKey } from './locales.ts'

/** Props of the catalog-backed model select shared by the assistant pickers. */
export interface ModelSelectProps {
  options: readonly AssistantModelOption[]
  value: string
  onChange: (value: string) => void
  t: (key: AssistantLocaleKey) => string
  className?: string | undefined
  /** Empty-selection label; the empty option is offered only while the value is empty unless `keepUnset`. */
  unsetLabel?: string | undefined
  /** Keep the empty option available while a catalog route is selected. */
  keepUnset?: boolean | undefined
  testId?: string | undefined
}

/**
 * Select one `provider:model` route from the served catalog. A route the
 * catalog no longer lists stays visible and is explicitly marked unavailable
 * instead of silently rendering an unmatched value.
 * @param props - catalog options, current route value, and change handler.
 * @returns the rendered select control.
 */
export function ModelSelect({
  options,
  value,
  onChange,
  t,
  className,
  unsetLabel,
  keepUnset = false,
  testId,
}: ModelSelectProps): ReactElement {
  const currentRoute = parseModelRoute(value)
  const currentMissing = value !== ''
    && !options.some(option => `${option.provider}:${option.id}` === value)

  return (
    <select
      className={className}
      data-testid={testId}
      value={value}
      onChange={(event) => { onChange(event.target.value) }}
    >
      {unsetLabel !== undefined && (keepUnset || value === '') && (
        <option value="">{unsetLabel}</option>
      )}
      {options.map(option => (
        <option key={`${option.provider}:${option.id}`} value={`${option.provider}:${option.id}`}>
          {option.provider} / {option.name}
        </option>
      ))}
      {currentMissing && (
        <option value={value}>
          {currentRoute
            ? `${currentRoute.provider} / ${currentRoute.model} ${t('modelUnavailable')}`
            : `${value} ${t('modelUnavailable')}`}
        </option>
      )}
    </select>
  )
}
