/**
 * Model-visible paragraph generated from {@link ASK_DATA_RULE_IDS}.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-data/prompt-limits
 */

import { ASK_DATA_RULE_IDS } from './limits.ts'

/**
 * One short Chinese paragraph that names every v1 rule id.
 * @returns the model-visible limits text.
 */
export function renderAskDataLimitsPrompt(): string {
  return [
    `问数导入限制（${ASK_DATA_RULE_IDS.join(' ')}）。`,
    '只接受 .xlsx / .csv（accept-xlsx-csv）；一份文件一个数据源，每个工作表一张表（one-file-one-source）。',
    '第一行是表头（first-row-header）；空表头变为 col、col_2（header-empty）；重复表头加 _2（header-duplicate）。',
    '类型为整数 / 浮点 / 文本 / 日期，混列作文本（type-guess）；表名冲突加 _2（sheet-name）。',
    '解码后超过 50MB（file-size）、合计超过 20 万行（row-count）、或约 200MB 单元格（decoded-cell）则拒绝，先到先拒。',
    'CSV 仅 UTF-8 或 GB18030，入库为 UTF-8（csv-encoding）。',
    '不修复合并单元格、不合并两行表头、不删备注行（no-merge-repair）。',
    '已绑定连接只读，不能改表。',
    'Catalog 在绑定后才会登记；目录仍空时不要调用 catalog-search，直接用 sql-query 读 sqlite_master 或 PRAGMA table_info。',
  ].join('')
}
