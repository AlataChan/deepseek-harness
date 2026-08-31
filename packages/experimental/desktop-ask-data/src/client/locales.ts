/**
 * User-facing 问数 copy. Chinese is the desktop default; English is the fallback.
 * Rule ids from `limits.ts` must appear in the five shared surfaces.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-data/client/locales
 */

/** Dictionary keys owned by this overlay. */
export type AskDataKey = keyof typeof zh

/** Chinese desktop copy. */
export const zh = {
  chip: '问数',
  title: '选一份要问的数据',
  pageLead: '先选数据再提问。accept-xlsx-csv one-file-one-source first-row-header header-empty header-duplicate type-guess sheet-name file-size row-count decoded-cell csv-encoding no-merge-repair。只接受 .xlsx / .csv；一份文件一个数据源；第一行是表头；空表头变为 col；重复表头加 _2；混列作文本；表名冲突加 _2；超过 50MB 或合计 20 万行或约 200MB 单元格则拒绝；CSV 仅 UTF-8 或 GB18030；不修复合并单元格。',
  uploadHelper: '上传前请确认：第一行是表头，只要 .xlsx / .csv，不超过 50MB，合计不超过 20 万行。accept-xlsx-csv one-file-one-source first-row-header header-empty header-duplicate type-guess sheet-name file-size row-count decoded-cell csv-encoding no-merge-repair。',
  previewLimits: '将按同一套规则入库：第一行表头，.xlsx / .csv，50MB / 20 万行。accept-xlsx-csv one-file-one-source first-row-header header-empty header-duplicate type-guess sheet-name file-size row-count decoded-cell csv-encoding no-merge-repair。',
  failureLimits: '失败原因见规则。改用示例可跳过上传。accept-xlsx-csv one-file-one-source first-row-header header-empty header-duplicate type-guess sheet-name file-size row-count decoded-cell csv-encoding no-merge-repair。',
  sample: '先用示例试一次',
  upload: '上传表格',
  advanced: '高级连接',
  recent: '最近使用',
  allSources: '全部数据源',
  missing: '找不到这份表',
  reselect: '重新选文件',
  start: '开始提问',
  importAnyway: '仍要导入',
  useSample: '改用示例',
  cancel: '取消',
  sqlite3Missing: '这台电脑找不到 sqlite3，无法上传表格；仍可用示例。sqlite3-missing',
  warningMerged: '有合并单元格，只取左上角。merged-cells',
  warningSecondHeader: '第二行也像表头。second-row-header',
  warningHeaderEmpty: '空表头已改成 col。header-empty',
  warningHeaderDuplicate: '重复表头已加后缀。header-duplicate',
  warningSparse: '第一行空单元格偏多。sparse-first-row',
  warningTypeGuess: '混列已按文本保存。type-guess',
  warningSheetName: '表名冲突已加后缀。sheet-name',
  tables: '表',
  rows: '行',
  columns: '列',
  loading: '正在处理…',
} as const

/** English fallback. */
export const en = {
  chip: 'Ask data',
  title: 'Choose a data source',
  pageLead: 'Pick data before you ask. accept-xlsx-csv one-file-one-source first-row-header header-empty header-duplicate type-guess sheet-name file-size row-count decoded-cell csv-encoding no-merge-repair. Only .xlsx / .csv; one file is one source; first row is the header; empty headers become col; duplicate headers get _2; mixed types become text; colliding sheet names get _2; reject at 50MB or 200,000 rows or ~200MB of cells; CSV must be UTF-8 or GB18030; merge cells are not repaired.',
  uploadHelper: 'Before you pick a file: first row is the header, .xlsx / .csv only, 50MB max, 200,000 rows across sheets. accept-xlsx-csv one-file-one-source first-row-header header-empty header-duplicate type-guess sheet-name file-size row-count decoded-cell csv-encoding no-merge-repair.',
  previewLimits: 'Import uses the same rules: header row, .xlsx / .csv, 50MB / 200,000 rows. accept-xlsx-csv one-file-one-source first-row-header header-empty header-duplicate type-guess sheet-name file-size row-count decoded-cell csv-encoding no-merge-repair.',
  failureLimits: 'The failure names the rule. Use the sample to skip the upload. accept-xlsx-csv one-file-one-source first-row-header header-empty header-duplicate type-guess sheet-name file-size row-count decoded-cell csv-encoding no-merge-repair.',
  sample: 'Try the sample first',
  upload: 'Upload a spreadsheet',
  advanced: 'Advanced connection',
  recent: 'Recent',
  allSources: 'All sources',
  missing: 'This table is missing',
  reselect: 'Choose another file',
  start: 'Start asking',
  importAnyway: 'Import anyway',
  useSample: 'Use the sample instead',
  cancel: 'Cancel',
  sqlite3Missing: 'sqlite3 is not on this computer, so upload is unavailable; the sample still works. sqlite3-missing',
  warningMerged: 'Merged cells keep the top-left value. merged-cells',
  warningSecondHeader: 'The second row also looks like a header. second-row-header',
  warningHeaderEmpty: 'Empty headers became col. header-empty',
  warningHeaderDuplicate: 'Duplicate headers were suffixed. header-duplicate',
  warningSparse: 'The first row has many empty cells. sparse-first-row',
  warningTypeGuess: 'Mixed columns were stored as text. type-guess',
  warningSheetName: 'Colliding sheet names were suffixed. sheet-name',
  tables: 'tables',
  rows: 'rows',
  columns: 'columns',
  loading: 'Working…',
} as const
