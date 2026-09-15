/**
 * Deterministic platform CSV rendering with spreadsheet-formula neutralization.
 * @module @deepseek-ai/dsh-experimental-commerce-mode/provider/export
 */

import { CommerceError, type CommerceChange, type CommerceValue } from '@deepseek-ai/dsh-host-commerce'
import type { PlatformConfig } from './types.ts'

const FORMULA_PREFIX = /^[=+\-@\t\r]/u

/**
 * Render staged changes without performing filesystem I/O.
 * @param changes - grounded staged changes.
 * @param platform - selected platform mapping.
 * @returns complete CSV document.
 */
export function renderChangesCsv(
  changes: readonly CommerceChange[],
  platform: PlatformConfig,
): string {
  const valueKeys = [...new Set(changes.flatMap(change => Object.keys(change.after)))].sort()
  const headers = ['change_id', 'change_kind', 'listing_id', ...valueKeys.map(key => exportHeader(platform, key))]
  const rows = changes.map(change => [
    change.id,
    change.kind,
    change.listingId ?? '',
    ...valueKeys.map(key => change.after[key] ?? null),
  ])
  return `${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n')}\n`
}

function exportHeader(platform: PlatformConfig, key: string): string {
  const mapped = platform.products?.[key] ?? platform.inventory?.[key] ?? platform.orders?.[key]
  return mapped ?? key
}

function csvCell(value: CommerceValue): string {
  if (value === null) return ''
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CommerceError('export-invalid', 'commerce export contains a non-finite number', {
        ruleId: 'csv-number',
      })
    }
    return String(value)
  }
  const raw = typeof value === 'boolean' ? String(value) : value
  const safe = FORMULA_PREFIX.test(raw) ? `'${raw}` : raw
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}
