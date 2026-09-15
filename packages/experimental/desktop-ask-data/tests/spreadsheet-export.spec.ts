/** Supported package-name spreadsheet decoder entry point. */

import { describe, expect, it } from 'vitest'
import * as spreadsheet from '@deepseek-ai/dsh-experimental-desktop-ask-data/spreadsheet'
import type {
  AskDataWarningId,
  ImportedTable,
  ParsedWorkbook,
} from '@deepseek-ai/dsh-experimental-desktop-ask-data/spreadsheet'

describe('spreadsheet export', () => {
  it('decodes a fictional CSV through the supported package entry', async () => {
    const bytes = new TextEncoder().encode('sku,title,stock\nTEA-1,Jasmine tea,4\n')

    const parsed: ParsedWorkbook = await spreadsheet.parseSpreadsheet('products.csv', bytes)
    const table: ImportedTable | undefined = parsed.tables[0]
    const warnings: readonly AskDataWarningId[] = parsed.warnings

    expect(table).toEqual({
      name: 'sheet',
      columns: ['sku', 'title', 'stock'],
      rows: [['TEA-1', 'Jasmine tea', 4]],
    })
    expect(warnings).toEqual([])
  })

  it('exports only the supported decoder and SQLite writer surface', () => {
    expect(spreadsheet.ACCEPTED_EXTENSIONS).toEqual(['xlsx', 'csv'])
    expect(typeof spreadsheet.MAX_DECODED_FILE_BYTES).toBe('number')
    expect(typeof spreadsheet.MAX_TOTAL_ROWS).toBe('number')
    expect(typeof spreadsheet.MAX_DECODED_CELL_BYTES).toBe('number')
    expect(typeof spreadsheet.parseSpreadsheet).toBe('function')
    expect(typeof spreadsheet.extensionOf).toBe('function')
    expect(typeof spreadsheet.findSqlite3).toBe('function')
    expect(typeof spreadsheet.writeSqliteFile).toBe('function')
    expect(typeof spreadsheet.readSqlitePreview).toBe('function')
    expect(typeof spreadsheet.quoteIdent).toBe('function')
    expect('SAMPLE_DISPLAY_NAME' in spreadsheet).toBe(false)
    expect('ASK_DATA_RULE_IDS' in spreadsheet).toBe(false)
    expect('ASK_DATA_WARNING_IDS' in spreadsheet).toBe(false)
    expect('isAskDataRuleId' in spreadsheet).toBe(false)
    expect('renderAskDataLimitsPrompt' in spreadsheet).toBe(false)
    expect('uniqueSheetName' in spreadsheet).toBe(false)
    expect('uniquifyHeaders' in spreadsheet).toBe(false)
    expect('quoteValue' in spreadsheet).toBe(false)
  })
})
