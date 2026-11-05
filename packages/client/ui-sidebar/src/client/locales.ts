/** `sidebar` namespace dictionaries for shell controls and global panels. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'session.new': '新会话',
  'session.new.label': '新建会话',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
  'region.sessions': '会话',
  'region.files': '文件',
  'panels.label': '全局面板',
  'panels.more': '更多面板',
  'panels.pin': '固定{name}',
  'panels.unpin': '取消固定{name}',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
  'region.sessions': 'Sessions',
  'region.files': 'Files',
  'panels.label': 'Global panels',
  'panels.more': 'More panels',
  'panels.pin': 'Pin {name}',
  'panels.unpin': 'Unpin {name}',
} satisfies Record<SidebarKey, string>
