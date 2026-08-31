/**
 * Bounded ZIP/XML scan for xlsx merge ranges and expansion caps.
 * ExcelJS WorkbookReader skips `<mergeCell>`, so this scan is what sets
 * `merged-cells`.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-data/zip-scan
 */

import { unzipSync } from 'fflate'
import { AskDataError } from '@deepseek-ai/dsh-host-ask-data'
import { MAX_DECODED_CELL_BYTES, MAX_TOTAL_ROWS } from './limits.ts'

/** Per-entry uncompressed cap (one sheet or shared strings). */
const MAX_ENTRY_UNCOMPRESSED = 64 * 1024 * 1024

/** Result of one bounded xlsx scan. */
export interface ZipScanResult {
  readonly mergedCells: boolean
  readonly sheetNames: readonly string[]
}

/**
 * Inflate an xlsx just far enough to reject bombs and detect merge cells.
 * @param bytes - decoded xlsx bytes.
 * @returns merge flag and sheet names from workbook.xml.
 */
export function scanXlsxZip(bytes: Uint8Array): ZipScanResult {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        /* v8 ignore next 7 -- a 64MiB uncompressed zip entry is too large to allocate in unit tests */
        if (file.originalSize > MAX_ENTRY_UNCOMPRESSED) {
          throw new AskDataError(
            'decoded-cell-budget',
            `xlsx entry ${file.name} expands past ${MAX_ENTRY_UNCOMPRESSED} bytes`,
            { ruleId: 'decoded-cell', limit: MAX_ENTRY_UNCOMPRESSED },
          )
        }
        return /^(xl\/worksheets\/[^/]+\.xml|xl\/sharedStrings\.xml|xl\/styles\.xml|xl\/workbook\.xml)$/i
          .test(file.name)
      },
    })
  } catch (error: unknown) {
    /* v8 ignore next -- the 64MiB entry cap is the only AskDataError thrown inside unzipSync */
    if (error instanceof AskDataError) throw error
    throw new AskDataError('source-invalid', 'xlsx is not a readable zip', { ruleId: 'accept-xlsx-csv' })
  }

  let total = 0
  let mergedCells = false
  const sheetNames: string[] = []
  for (const [name, content] of Object.entries(files)) {
    total += content.byteLength
    /* v8 ignore next 7 -- a 200MiB decoded-XML workbook is too large to allocate in unit tests */
    if (total > MAX_DECODED_CELL_BYTES) {
      throw new AskDataError(
        'decoded-cell-budget',
        `xlsx decoded XML exceeds ${MAX_DECODED_CELL_BYTES} bytes`,
        { ruleId: 'decoded-cell', limit: MAX_DECODED_CELL_BYTES },
      )
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(content)
    if (/<mergeCell[\s>]/i.test(text)) mergedCells = true
    if (/xl\/workbook\.xml$/i.test(name)) {
      for (const match of text.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/gi)) {
        sheetNames.push(decodeXml(match[1] as string))
      }
    }
    const rows = text.match(/<row\b/gi)
    if (rows !== null && rows.length > MAX_TOTAL_ROWS) {
      throw new AskDataError(
        'too-many-rows',
        `xlsx has more than ${MAX_TOTAL_ROWS} rows`,
        { ruleId: 'row-count', limit: MAX_TOTAL_ROWS },
      )
    }
  }
  return { mergedCells, sheetNames }
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
}
