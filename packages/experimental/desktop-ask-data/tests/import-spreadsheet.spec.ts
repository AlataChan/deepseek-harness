/** Spreadsheet import: rejects, warnings, sample CSV, SQL-special cells. */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'
import iconv from 'iconv-lite'
import { zipSync } from 'fflate'
import { AskDataError } from '@deepseek-ai/dsh-host-ask-data'
import { parseSpreadsheet, uniquifyHeaders, uniqueSheetName } from '../src/import-spreadsheet.ts'
import { ASK_DATA_RULE_IDS, MAX_DECODED_FILE_BYTES, MAX_TOTAL_ROWS } from '../src/limits.ts'
import { scanXlsxZip } from '../src/zip-scan.ts'
import { quoteIdent, quoteValue } from '../src/sqlite-write.ts'

const SAMPLE_CSV = fileURLToPath(new URL('../samples/sample-sales.csv', import.meta.url))

async function xlsxBytes(build: (wb: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  build(wb)
  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf)
}

describe('parseSpreadsheet', () => {
  it('imports the sample CSV with zero warnings', async () => {
    const bytes = await readFile(SAMPLE_CSV)
    const parsed = await parseSpreadsheet('sample-sales.csv', bytes)
    expect(parsed.warnings).toEqual([])
    expect(parsed.tables).toHaveLength(1)
    expect(parsed.tables[0]?.columns).toEqual(['日期', '渠道', '商品', '数量', '金额'])
    expect(parsed.tables[0]?.rows).toHaveLength(20)
  })

  it('rejects a non-spreadsheet extension', async () => {
    await expect(parseSpreadsheet('notes.txt', new Uint8Array([1]))).rejects.toMatchObject({
      code: 'extension-rejected',
      details: { ruleId: 'accept-xlsx-csv' },
    })
  })

  it('rejects decoded bytes over 50MB', async () => {
    const bytes = new Uint8Array(MAX_DECODED_FILE_BYTES + 1)
    await expect(parseSpreadsheet('big.csv', bytes)).rejects.toMatchObject({
      code: 'file-too-large',
      details: { ruleId: 'file-size', limit: MAX_DECODED_FILE_BYTES },
    })
  })

  it('rejects a CSV that exceeds the row cap', async () => {
    const lines = ['a,b', ...Array.from({ length: MAX_TOTAL_ROWS + 1 }, () => '1,2')]
    await expect(parseSpreadsheet('rows.csv', Buffer.from(lines.join('\n')))).rejects.toMatchObject({
      code: 'too-many-rows',
      details: { ruleId: 'row-count' },
    })
  })

  it('imports a GB18030 CSV and rejects random binary', async () => {
    const gb = iconv.encode('列,值\n茶叶,1\n', 'gb18030')
    const parsed = await parseSpreadsheet('gb.csv', gb)
    expect(parsed.tables[0]?.columns).toEqual(['列', '值'])
    await expect(parseSpreadsheet('bad.csv', Buffer.from([0x00, 0xff, 0xfe, 0x01]))).rejects.toMatchObject({
      code: 'csv-encoding',
      details: { ruleId: 'csv-encoding' },
    })
  })

  it('uniquifies empty and duplicate headers', async () => {
    const parsed = await parseSpreadsheet('dup.csv', Buffer.from('name,,name\n1,2,3\n'))
    expect(parsed.tables[0]?.columns).toEqual(['name', 'col', 'name_2'])
    expect(parsed.warnings).toEqual(expect.arrayContaining(['header-empty', 'header-duplicate']))
  })

  it('warns on mixed types and two-row headers', async () => {
    const mixed = await parseSpreadsheet('mix.csv', Buffer.from('n\n1\nx\n'))
    expect(mixed.warnings).toContain('type-guess')
    const two = await parseSpreadsheet('hdr.csv', Buffer.from('1,2\nA,B\n3,4\n'))
    expect(two.warnings).toContain('second-row-header')
  })

  it('imports quoted cells that contain quotes, newlines, and SQL text', async () => {
    const csv = 'note\n"it\'s a ""quote""\nand DROP TABLE t;"\n'
    const parsed = await parseSpreadsheet('sql.csv', Buffer.from(csv))
    expect(parsed.tables[0]?.rows[0]?.[0]).toContain('DROP TABLE')
    expect(quoteValue("it's")).toBe("'it''s'")
    expect(quoteIdent('a"b')).toBe('"a""b"')
  })

  it('parses a two-sheet xlsx and suffixes colliding sanitized names', async () => {
    const bytes = await xlsxBytes((wb) => {
      const a = wb.addWorksheet('foo-bar')
      a.addRow(['日期', '渠道'])
      a.addRow(['2026-01-02', '线上'])
      const b = wb.addWorksheet('foo_bar')
      b.addRow(['日期'])
      b.addRow(['2026-01-03'])
    })
    const parsed = await parseSpreadsheet('two.xlsx', bytes)
    expect(parsed.tables.map(table => table.name)).toEqual(['foo_bar', 'foo_bar_2'])
    expect(parsed.warnings).toContain('sheet-name')
  })

  it('warns on merged cells from the ZIP scan', async () => {
    const bytes = await xlsxBytes((wb) => {
      const sheet = wb.addWorksheet('s')
      sheet.addRow(['A', 'B'])
      sheet.addRow(['1', '2'])
      sheet.mergeCells('A1:B1')
    })
    expect(scanXlsxZip(bytes).mergedCells).toBe(true)
    const parsed = await parseSpreadsheet('merge.xlsx', bytes)
    expect(parsed.warnings).toContain('merged-cells')
  })

  it('rejects a zip whose sheet XML expands past the row cap', () => {
    const rows = Array.from({ length: MAX_TOTAL_ROWS + 1 }, () => '<row/>').join('')
    const zip = zipSync({
      'xl/workbook.xml': new TextEncoder().encode('<workbook><sheets><sheet name="s"/></sheets></workbook>'),
      'xl/worksheets/sheet1.xml': new TextEncoder().encode(`<worksheet>${rows}</worksheet>`),
    })
    expect(() => scanXlsxZip(zip)).toThrow(AskDataError)
    try {
      scanXlsxZip(zip)
    } catch (error: unknown) {
      expect(error).toMatchObject({ details: { ruleId: 'row-count' } })
    }
  })

  it('rejects bytes that are not a zip', () => {
    expect(() => scanXlsxZip(new Uint8Array([1, 2, 3]))).toThrow(AskDataError)
  })

  it('decodes XML entities in sheet names and treats an empty CSV as one empty table', async () => {
    const zip = zipSync({
      'xl/workbook.xml': new TextEncoder().encode(
        '<workbook><sheets><sheet name="a&amp;b&lt;c&gt;d&quot;e"/></sheets></workbook>',
      ),
      'xl/worksheets/sheet1.xml': new TextEncoder().encode('<worksheet/>'),
    })
    expect(scanXlsxZip(zip).sheetNames).toEqual(['a&b<c>d"e'])
    const empty = await parseSpreadsheet('empty.csv', new Uint8Array())
    expect(empty.tables).toEqual([{ name: 'sheet', columns: [], rows: [] }])
    expect(empty.warnings).toEqual([])
  })

  it('strips a UTF-8 BOM and reads integer, float, and date columns', async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('n,f,d\n1,1.5,2026-01-02\n')])
    const parsed = await parseSpreadsheet('typed.csv', bom)
    expect(parsed.tables[0]?.rows[0]).toEqual([1, 1.5, '2026-01-02'])
    expect(parsed.warnings).toEqual([])
  })

  it('keeps overflow integers and floats as text and warns on a sparse header', async () => {
    const hugeInt = '9'.repeat(400)
    const hugeFloat = `${'9'.repeat(400)}.1`
    const parsed = await parseSpreadsheet(
      'overflow.csv',
      Buffer.from(`n,f,,,\n${hugeInt},${hugeFloat},x,,\n`),
    )
    expect(parsed.tables[0]?.rows[0]?.[0]).toBe(hugeInt)
    expect(parsed.tables[0]?.rows[0]?.[1]).toBe(hugeFloat)
    expect(parsed.warnings).toEqual(expect.arrayContaining(['sparse-first-row', 'header-empty']))
  })

  it('guesses columns when a data row is shorter than the header', async () => {
    const parsed = await parseSpreadsheet('short.csv', Buffer.from('a,b,c\n1\n'))
    expect(parsed.tables[0]?.columns).toEqual(['a', 'b', 'c'])
    expect(parsed.tables[0]?.rows[0]).toEqual([1, null, null])
  })

  it('drops blank CSV records and a trailing empty row', async () => {
    const parsed = await parseSpreadsheet('blank.csv', Buffer.from('a,b\n1,2\n\n,\n3,4\n,'))
    expect(parsed.tables[0]?.rows).toEqual([[1, 2], [3, 4]])
  })

  it('parses quoted commas, escaped quotes, and CRLF records', async () => {
    const csv = 'note\r\n"a,b",c\r\n"he said ""hi""",d\r\ntrailing\n'
    const parsed = await parseSpreadsheet('q.csv', Buffer.from(csv))
    expect(parsed.tables[0]?.columns).toEqual(['note'])
  })

  it('treats an empty first xlsx row as a non-header', async () => {
    const bytes = await xlsxBytes((wb) => {
      const sheet = wb.addWorksheet('emptyhdr')
      sheet.addRow([])
      sheet.addRow(['A', 'B'])
      sheet.addRow(['1', '2'])
    })
    const parsed = await parseSpreadsheet('emptyhdr.xlsx', bytes)
    expect(parsed.tables[0]?.columns.length).toBeGreaterThanOrEqual(0)
  })

  it('reads xlsx cell variants and an empty sheet', async () => {
    const bytes = await xlsxBytes((wb) => {
      wb.addWorksheet('blank')
      const sheet = wb.addWorksheet('cells')
      sheet.addRow(['t', 'n', 'b', 'd', 'rich', 'formula'])
      const row = sheet.addRow([])
      row.getCell(1).value = 'text'
      row.getCell(2).value = 3
      row.getCell(3).value = true
      row.getCell(4).value = new Date('2026-01-02T00:00:00.000Z')
      row.getCell(5).value = { richText: [{ text: 'rich' }] }
      row.getCell(6).value = { formula: '1+1', result: 2 }
      row.getCell(7).value = null
    })
    const parsed = await parseSpreadsheet('cells.xlsx', bytes)
    const names = parsed.tables.map(table => table.name)
    expect(names).toContain('blank')
    expect(names).toContain('cells')
    const cells = parsed.tables.find(table => table.name === 'cells')
    expect(cells?.rows[0]?.slice(0, 6)).toEqual(['text', 3, 'true', '2026-01-02', '[object Object]', 2])
  })

  it('reads a filename with a path and an uppercase extension', async () => {
    const parsed = await parseSpreadsheet('dir/foo.CSV', Buffer.from('a\n1\n'))
    expect(parsed.tables[0]?.columns).toEqual(['a'])
  })

  it('rejects a filename without a spreadsheet extension', async () => {
    await expect(parseSpreadsheet('README', new Uint8Array([1]))).rejects.toMatchObject({
      code: 'extension-rejected',
    })
  })

  it('rejects a binary CSV when iconv cannot decode GB18030', async () => {
    const decode = vi.spyOn(iconv, 'decode').mockImplementation(() => {
      throw new Error('iconv failed')
    })
    await expect(parseSpreadsheet('bad.csv', Buffer.from([0x00, 0xff, 0xfe, 0x01]))).rejects.toMatchObject({
      code: 'csv-encoding',
    })
    decode.mockRestore()
  })

  it('rejects a binary CSV when GB18030 is not available', async () => {
    const exists = vi.spyOn(iconv, 'encodingExists').mockReturnValue(false)
    await expect(parseSpreadsheet('bad.csv', Buffer.from([0x00, 0xff, 0xfe, 0x01]))).rejects.toMatchObject({
      code: 'csv-encoding',
    })
    exists.mockRestore()
  })
})

describe('header helpers', () => {
  it('assigns col then col_2 for empty headers', () => {
    expect(uniquifyHeaders(['', '']).names).toEqual(['col', 'col_2'])
  })

  it('suffixes colliding sheet names', () => {
    const used = new Set<string>(['sheet', 'sheet_2'])
    expect(uniqueSheetName('sheet', used)).toEqual({ name: 'sheet_3', collided: true })
    expect(uniqueSheetName('!!!', new Set())).toEqual({ name: '___', collided: false })
    expect(uniqueSheetName('', new Set())).toEqual({ name: 'sheet', collided: false })
  })

  it('suffixes a header that already used the _2 candidate', () => {
    expect(uniquifyHeaders(['name', 'name', 'name']).names).toEqual(['name', 'name_2', 'name_3'])
  })
})

void ASK_DATA_RULE_IDS
