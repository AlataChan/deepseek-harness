/** `commerce-mode` namespace dictionaries for the staged-change, discard, and export tool cards. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'commerce-mode'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'row.stage': '暂存改动',
  'row.discard': '丢弃改动',
  'row.export': '导出改动',
  'row.running': '正在处理',
  'row.failed': '处理失败',
  'row.stopped': '已中止',
  'row.inspect': '查看',
  'kind.listing-update': '商品信息',
  'kind.price-change': '调价',
  'kind.promotion': '促销',
  'kind.restock': '补货',
  'kind.campaign': '营销活动',
  'change.table': '改动明细',
  'change.listing': '商品',
  'change.field': '字段',
  'change.before': '改前',
  'change.after': '改后',
  'change.campaignLevel': '整个活动',
  'change.empty': '（空）',
  'change.window': '时间：{startsOn} 至 {endsOn}',
  'change.campaign': '活动：{name}（{count} 个商品）',
  'discard.summary': '已丢弃 {id}',
  'export.summary': '{count} 条改动 · {path}',
  'export.file': '导出文件',
  'export.open': '打开',
  'export.changes': '包含改动：{ids}',
  'export.notice': '没有发送到任何店铺，请商家自行上传这个文件。',
  'ledger.counts': '当前账本：待导出 {staged} · 已导出 {exported} · 已丢弃 {discarded}',
} satisfies Record<string, string>

/** The commerce-mode namespace key union. */
export type CommerceKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'row.stage': 'Stage change',
  'row.discard': 'Discard change',
  'row.export': 'Export changes',
  'row.running': 'Working',
  'row.failed': 'Failed',
  'row.stopped': 'Stopped',
  'row.inspect': 'Inspect',
  'kind.listing-update': 'Listing update',
  'kind.price-change': 'Price change',
  'kind.promotion': 'Promotion',
  'kind.restock': 'Restock',
  'kind.campaign': 'Campaign',
  'change.table': 'Change details',
  'change.listing': 'Listing',
  'change.field': 'Field',
  'change.before': 'Before',
  'change.after': 'After',
  'change.campaignLevel': 'Whole campaign',
  'change.empty': '(empty)',
  'change.window': 'Dates: {startsOn} to {endsOn}',
  'change.campaign': 'Campaign: {name}, listings: {count}',
  'discard.summary': 'Discarded {id}',
  'export.summary': '{count} exported · {path}',
  'export.file': 'Export file',
  'export.open': 'Open',
  'export.changes': 'Changes: {ids}',
  'export.notice': 'Nothing was sent to a store; the merchant uploads this file.',
  'ledger.counts': 'Current ledger: {staged} staged · {exported} exported · {discarded} discarded',
} satisfies Record<CommerceKey, string>
