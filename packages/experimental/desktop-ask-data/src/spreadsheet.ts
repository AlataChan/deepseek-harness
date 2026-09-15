/**
 * Supported spreadsheet decoder and SQLite table-writer entry for workspace
 * packages that reuse Ask Data's import limits and error vocabulary.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-data/spreadsheet
 */

export { extensionOf, parseSpreadsheet } from './import-spreadsheet.ts'
export type { ParsedWorkbook } from './import-spreadsheet.ts'
export {
  findSqlite3,
  quoteIdent,
  readSqlitePreview,
  writeSqliteFile,
} from './sqlite-write.ts'
export type { ImportedTable } from './sqlite-write.ts'
export {
  ACCEPTED_EXTENSIONS,
  MAX_DECODED_CELL_BYTES,
  MAX_DECODED_FILE_BYTES,
  MAX_TOTAL_ROWS,
} from './limits.ts'
export type { AskDataWarningId } from './limits.ts'
