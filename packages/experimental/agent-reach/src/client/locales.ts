/**
 * Locale-owned copy for Agent-Reach desktop client. Chinese is the default.
 *
 * @module @deepseek-ai/dsh-experimental-agent-reach/client/locales
 */

export const zh = {
  'tool.reach_channels': '平台能力',
  'tool.reach_status': '环境状态',
  'tool.reach_query': '平台查询',
  'tool.reach_setup': '环境配置',

  'card.channel': '平台',
  'card.action': '动作',
  'card.backend': '引擎',
  'card.access': '权限',
  'card.completeness': '状态',
  'card.items': '共 {count} 条内容',

  'scope.public': '公开只读',
  'scope.native': '原生协议',
  'scope.session': '浏览器会话',

  'completeness.complete': '完整',
  'completeness.truncated': '内容已截断',
  'completeness.partial': '部分加载',
  'completeness.snippet': '简略片段',
  'completeness.unknown': '未知',

  'setup.status.planned': '已生成安装计划',
  'setup.status.installed': '依赖已就绪',
  'setup.status.declined': '安装已取消',
  'setup.status.failed': '安装失败',
  'setup.status.unsupported': '当前环境暂不支持',
  'setup.status.not_needed': '环境已就绪',
  'setup.planOnly': '仅预览计划',
} as const

/** English labels paired with the Chinese default dictionary. */
export const en = {
  'tool.reach_channels': 'Channels',
  'tool.reach_status': 'Status',
  'tool.reach_query': 'Query',
  'tool.reach_setup': 'Setup',

  'card.channel': 'Channel',
  'card.action': 'Action',
  'card.backend': 'Backend',
  'card.access': 'Access',
  'card.completeness': 'Completeness',
  'card.items': '{count} item(s)',

  'scope.public': 'Public read',
  'scope.native': 'Native CLI',
  'scope.session': 'Browser session',

  'completeness.complete': 'Complete',
  'completeness.truncated': 'Truncated',
  'completeness.partial': 'Partial',
  'completeness.snippet': 'Snippet',
  'completeness.unknown': 'Unknown',

  'setup.status.planned': 'Plan ready',
  'setup.status.installed': 'Installed',
  'setup.status.declined': 'Declined',
  'setup.status.failed': 'Failed',
  'setup.status.unsupported': 'Unsupported',
  'setup.status.not_needed': 'Already ready',
  'setup.planOnly': 'Plan preview',
} as const

/** Keys accepted by the Agent-Reach locale namespace. */
export type ReachLocaleKey = keyof typeof zh

/** Locale namespace shared by the registered tool presenters. */
export const NS = 'desktop-agent-reach'
