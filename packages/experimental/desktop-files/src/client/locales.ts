/** `desktop-files` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'empty.session': '先开一个会话，这里会列出它的项目文件。',
  'empty.directory': '空目录',
  'error.unreadable': '无法读取',
  'error.outside': '不能浏览项目外面',
  'error.unavailable': '文件列表不可用',
  'truncated': '只显示前 1000 项',
  'refresh': '刷新',
  'hidden.show': '显示隐藏文件',
  'region.files': '文件',
} satisfies Record<string, string>

/** The desktop-files namespace key union. */
export type FilesKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'empty.session': 'Open a session to list its project files here.',
  'empty.directory': 'Empty directory',
  'error.unreadable': 'Unable to read',
  'error.outside': 'Cannot browse outside the project',
  'error.unavailable': 'File listing is unavailable',
  'truncated': 'Showing the first 1000 items',
  'refresh': 'Refresh',
  'hidden.show': 'Show hidden files',
  'region.files': 'Files',
} satisfies Record<FilesKey, string>
