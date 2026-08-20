/** `vscode` namespace dictionaries for explicit editor context. */

/** Simplified Chinese dictionary and key-set authority. */
export const zh = {
  'context.button.aria': '添加编辑器上下文',
  'context.button.title': '添加编辑器上下文',
  'context.selection': '当前选区',
  'context.file': '当前文件',
  'context.diagnostics': '当前文件的问题',
  'context.empty': '没有可添加的编辑器上下文。',
  'context.failed': '添加编辑器上下文失败。',
  'context.busy': '输入正在提交，请稍后重试。',
  'context.chip.diagnostics': '问题',
  'workspace.failed': '无法打开所选工作区。',
} satisfies Record<string, string>

/** Locale key union. */
export type VsCodeKey = keyof typeof zh

/** English dictionary checked against the Chinese source keys. */
export const en = {
  'context.button.aria': 'Add editor context',
  'context.button.title': 'Add editor context',
  'context.selection': 'Current selection',
  'context.file': 'Current file',
  'context.diagnostics': 'Problems in current file',
  'context.empty': 'No editor context is available to add.',
  'context.failed': 'Failed to add editor context.',
  'context.busy': 'Input is being submitted. Try again shortly.',
  'context.chip.diagnostics': 'Problems',
  'workspace.failed': 'Could not open the selected workspace.',
} satisfies Record<VsCodeKey, string>
