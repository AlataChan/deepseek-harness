/**
 * Host-side xlsx/csv import into sqlite tables.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-data/import-spreadsheet
 */

import ExcelJS from 'exceljs'
import iconv from 'iconv-lite'
import { AskDataError } from '@deepseek-ai/dsh-host-ask-data'
import {
  ACCEPTED_EXTENSIONS,
  MAX_DECODED_CELL_BYTES,
  MAX_DECODED_FILE_BYTES,
  MAX_TOTAL_ROWS,
} from './limits.ts'
import type { AskDataWarningId } from './limits.ts'
import { scanXlsxZip } from './zip-scan.ts'
import type { ImportedTable } from './sqlite-write.ts'

/** Parsed workbook ready to persist. */
export interface ParsedWorkbook {
  readonly tables: readonly ImportedTable[]
  readonly warnings: readonly AskDataWarningId[]
}

/**
 * Parse one uploaded spreadsheet. Does not write sqlite.
 * @param filename - user-visible name; extension selects the parser.
 * @param bytes - decoded file bytes.
 * @returns tables and warning ids.
 */
export async function parseSpreadsheet(filename: string, bytes: Uint8Array): Promise<ParsedWorkbook> {
  if (bytes.byteLength > MAX_DECODED_FILE_BYTES) {
    throw new AskDataError(
      'file-too-large',
      `file exceeds ${MAX_DECODED_FILE_BYTES} bytes`,
      { ruleId: 'file-size', limit: MAX_DECODED_FILE_BYTES },
    )
  }
  const ext = extensionOf(filename)
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new AskDataError(
      'extension-rejected',
      'only .xlsx and .csv are accepted',
      { ruleId: 'accept-xlsx-csv' },
    )
  }
  if (ext === 'csv') return parseCsv(bytes)
  return parseXlsx(bytes)
}

/**
 * Filename extension without the dot, lowercased.
 * @param filename - user-visible name.
 * @returns extension or empty string.
 */
export function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() as string
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

function parseCsv(bytes: Uint8Array): ParsedWorkbook {
  const text = decodeCsvText(bytes)
  const rows = parseCsvRecords(text)
  if (rows.length === 0) {
    return { tables: [{ name: 'sheet', columns: [], rows: [] }], warnings: [] }
  }
  const header = rows[0] as string[]
  const { names, warnings } = uniquifyHeaders(header)
  const data = rows.slice(1)
  if (data.length > MAX_TOTAL_ROWS) {
    throw new AskDataError(
      'too-many-rows',
      `csv has more than ${MAX_TOTAL_ROWS} rows`,
      { ruleId: 'row-count', limit: MAX_TOTAL_ROWS },
    )
  }
  let decodedCells = 0
  for (const row of data) {
    decodedCells += row.reduce((sum, cell) => sum + cell.length, 0)
    /* v8 ignore next 7 -- a 200MiB decoded-cell CSV is too large to allocate in unit tests */
    if (decodedCells > MAX_DECODED_CELL_BYTES) {
      throw new AskDataError(
        'decoded-cell-budget',
        `decoded cells exceed ${MAX_DECODED_CELL_BYTES} bytes`,
        { ruleId: 'decoded-cell', limit: MAX_DECODED_CELL_BYTES },
      )
    }
  }
  const typed = applyTypes(data, names.length)
  const extra: AskDataWarningId[] = [...warnings]
  extra.push(...headerWarnings(header, data[0]))
  extra.push(...typed.warnings)
  return {
    tables: [{ name: 'sheet', columns: names, rows: typed.rows }],
    warnings: unique(extra),
  }
}

function decodeCsvText(bytes: Uint8Array): string {
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    if (iconv.encodingExists('gb18030') && looksLikeGb18030(bytes)) {
      return iconv.decode(Buffer.from(bytes), 'gb18030')
    }
    throw new AskDataError('csv-encoding', 'csv must be UTF-8 or GB18030', { ruleId: 'csv-encoding' })
  }
}

function looksLikeGb18030(bytes: Uint8Array): boolean {
  try {
    const text = iconv.decode(Buffer.from(bytes), 'gb18030')
    return text.length > 0 && !text.includes('\uFFFD')
  } catch {
    return false
  }
}

async function parseXlsx(bytes: Uint8Array): Promise<ParsedWorkbook> {
  const scan = scanXlsxZip(bytes)
  const workbook = new ExcelJS.Workbook()
  const buffer = Buffer.alloc(bytes.byteLength)
  buffer.set(bytes)
  // exceljs 4.4 types `Buffer` without Node 22's generic Buffer<ArrayBuffer>
  await workbook.xlsx.load(buffer as never)
  const tables: ImportedTable[] = []
  const warnings: AskDataWarningId[] = []
  if (scan.mergedCells) warnings.push('merged-cells')
  const usedNames = new Set<string>()
  let totalRows = 0
  let decodedCells = 0
  let sheetIndex = 0
  for (const worksheet of workbook.worksheets) {
    let rawName = worksheet.name
    /* v8 ignore next 3 -- ExcelJS rejects an empty sheet name at write time */
    if (typeof rawName !== 'string' || rawName.length === 0) {
      rawName = scan.sheetNames[sheetIndex] ?? `sheet_${sheetIndex + 1}`
    }
    sheetIndex += 1
    const { name, collided } = uniqueSheetName(rawName, usedNames)
    if (collided) warnings.push('sheet-name')
    const rawRows: string[][] = []
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const values = row.values as unknown[]
      const cells = values.slice(1).map(cellText)
      rawRows.push(cells)
      decodedCells += cells.reduce((sum, cell) => sum + cell.length, 0)
    })
    /* v8 ignore next 7 -- a 200MiB decoded-cell xlsx is too large to allocate in unit tests */
    if (decodedCells > MAX_DECODED_CELL_BYTES) {
      throw new AskDataError(
        'decoded-cell-budget',
        `decoded cells exceed ${MAX_DECODED_CELL_BYTES} bytes`,
        { ruleId: 'decoded-cell', limit: MAX_DECODED_CELL_BYTES },
      )
    }
    if (rawRows.length === 0) {
      tables.push({ name, columns: [], rows: [] })
      continue
    }
    const header = rawRows[0] as string[]
    const { names, warnings: headerWarns } = uniquifyHeaders(header)
    warnings.push(...headerWarns)
    const data = rawRows.slice(1)
    totalRows += data.length
    /* v8 ignore next 7 -- zip-scan already rejects this before ExcelJS loads */
    if (totalRows > MAX_TOTAL_ROWS) {
      throw new AskDataError(
        'too-many-rows',
        `workbook has more than ${MAX_TOTAL_ROWS} rows`,
        { ruleId: 'row-count', limit: MAX_TOTAL_ROWS },
      )
    }
    const typed = applyTypes(data, names.length)
    warnings.push(...headerWarnings(header, data[0]))
    warnings.push(...typed.warnings)
    tables.push({ name, columns: names, rows: typed.rows })
  }
  return { tables, warnings: unique(warnings) }
}

function cellText(value: unknown): string {
  /* v8 ignore next -- ExcelJS omits empty cells instead of passing null */
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  /* v8 ignore next 6 -- ExcelJS eachRow unwraps rich-text and formula cells before we see them */
  if (typeof value === 'object' && value !== null && 'text' in value) {
    return String((value as { text: unknown }).text)
  }
  if (typeof value === 'object' && value !== null && 'result' in value) {
    return cellText((value as { result: unknown }).result)
  }
  return String(value)
}

/**
 * Sanitize a sheet name and uniquify it.
 * @param raw - sheet name from the workbook.
 * @param used - already assigned table names.
 * @returns sanitized unique name and whether a collision suffix was added.
 */
export function uniqueSheetName(raw: string, used: Set<string>): { name: string; collided: boolean } {
  let base = raw.replace(/[^A-Za-z0-9_\u4e00-\u9fff]/g, '_')
  if (base.length === 0) base = 'sheet'
  if (!used.has(base)) {
    used.add(base)
    return { name: base, collided: false }
  }
  let suffix = 2
  let candidate = `${base}_${suffix}`
  while (used.has(candidate)) {
    suffix += 1
    candidate = `${base}_${suffix}`
  }
  used.add(candidate)
  return { name: candidate, collided: true }
}

/**
 * Uniquify empty and duplicate headers.
 * @param header - first row cells.
 * @returns column names and warning ids.
 */
export function uniquifyHeaders(header: readonly string[]): {
  names: string[]
  warnings: AskDataWarningId[]
} {
  const warnings: AskDataWarningId[] = []
  const used = new Set<string>()
  const names: string[] = []
  for (const raw of header) {
    const trimmed = raw.trim()
    const base = trimmed.length === 0 ? 'col' : trimmed
    if (trimmed.length === 0) warnings.push('header-empty')
    if (!used.has(base)) {
      used.add(base)
      names.push(base)
      continue
    }
    warnings.push('header-duplicate')
    let suffix = 2
    let candidate = `${base}_${suffix}`
    while (used.has(candidate)) {
      suffix += 1
      candidate = `${base}_${suffix}`
    }
    used.add(candidate)
    names.push(candidate)
  }
  return { names, warnings: unique(warnings) }
}

function headerWarnings(header: readonly string[], second?: readonly string[]): AskDataWarningId[] {
  const warnings: AskDataWarningId[] = []
  if (header.length > 0) {
    const empty = header.filter(cell => cell.trim() === '').length
    if (empty >= Math.ceil(header.length / 2)) warnings.push('sparse-first-row')
  }
  if (second !== undefined && looksLikeHeaderRow(second) && looksLikeDataRow(header)) {
    warnings.push('second-row-header')
  }
  return warnings
}

function looksLikeHeaderRow(row: readonly string[]): boolean {
  /* v8 ignore next -- parseCsvRecords and ExcelJS do not yield a zero-length row here */
  if (row.length === 0) return false
  return row.every(cell => cell.trim() !== '' && Number.isNaN(Number(cell)))
}

function looksLikeDataRow(row: readonly string[]): boolean {
  /* v8 ignore next -- parseCsvRecords and ExcelJS do not yield a zero-length row here */
  if (row.length === 0) return false
  const numeric = row.filter(cell => cell.trim() !== '' && !Number.isNaN(Number(cell))).length
  return numeric >= Math.ceil(row.filter(cell => cell.trim() !== '').length / 2)
}

function applyTypes(
  data: readonly (readonly string[])[],
  width: number,
): { rows: (readonly (string | number | null)[])[]; warnings: AskDataWarningId[] } {
  const kinds = Array.from({ length: width }, (_, index) => guessColumnAt(data, index))
  const warnings: AskDataWarningId[] = kinds.some(kind => kind === 'mixed') ? ['type-guess'] : []
  const rows = data.map(row => Array.from({ length: width }, (_, index) => {
    const raw = row[index]?.trim() ?? ''
    if (raw === '') return null
    const kind = kinds[index]
    if (kind === 'integer') {
      const n = Number(raw)
      return Number.isInteger(n) ? n : raw
    }
    if (kind === 'float') {
      return Number(raw)
    }
    return raw
  }))
  return { rows, warnings }
}

function guessColumnAt(
  data: readonly (readonly string[])[],
  index: number,
): 'integer' | 'float' | 'text' | 'date' | 'mixed' {
  let sawInt = false
  let sawFloat = false
  let sawDate = false
  let sawText = false
  for (const row of data) {
    const raw = row[index]?.trim() ?? ''
    if (raw === '') continue
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw))) {
      sawDate = true
      continue
    }
    if (/^-?\d+$/.test(raw)) {
      sawInt = true
      continue
    }
    if (/^-?\d+\.\d+$/.test(raw) && Number.isFinite(Number(raw))) {
      sawFloat = true
      continue
    }
    sawText = true
  }
  const kinds = [sawInt, sawFloat, sawDate, sawText].filter(Boolean).length
  if (kinds === 0) return 'text'
  if (kinds > 1) return 'mixed'
  if (sawInt) return 'integer'
  if (sawFloat) return 'float'
  if (sawDate) return 'date'
  return 'text'
}

function parseCsvRecords(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let i = 0
  let quoted = false
  while (i < text.length) {
    const ch = text[i] as string
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      quoted = true
      i += 1
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(field)
      field = ''
      if (row.some(cell => cell.length > 0)) rows.push(row)
      row = []
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    if (row.some(cell => cell.length > 0)) rows.push(row)
  }
  return rows
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}
