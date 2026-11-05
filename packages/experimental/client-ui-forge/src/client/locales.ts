/** Locale-owned copy for the one local Changes tab. */
export const NS = 'worktree-review'
/** Chinese dictionary and key source. */
export const zh = {
  title: '变更', open: '查看变更', description: '查看本地差异和独立工作目录',
  create: '使用独立工作目录', requested: '下次开始任务时创建独立工作目录', cancel: '取消创建', stop: '停止创建', retry: '重试',
  restore: '恢复工作目录', leave: '返回原项目', missing: '工作目录已丢失，可恢复已提交内容，未提交内容无法恢复',
  prepare: '正在准备工作目录', checkout: '正在检出文件', failed: '工作目录操作失败',
  original: '原项目', current: '当前执行目录', branch: '分支变更', uncommitted: '未提交', staged: '已暂存', unstaged: '未暂存',
  refresh: '刷新差异', empty: '没有本地变更', files: '变更文件', binary: '二进制文件', oversized: '文件过大，无法预览',
  disconnected: '连接已断开', unavailable: '无法读取本地差异', actionDone: '操作已完成', actionFailed: '操作失败，请重试',
  omitted: '部分未跟踪文件未显示', readonly: '当前会话只读', notGit: '当前目录不是 Git 项目',
} satisfies Record<string, string>
/** Dictionary key union. */
export type ForgePanelKey = keyof typeof zh
/** English dictionary. */
export const en = {
  title: 'Changes', open: 'View changes', description: 'Review local changes and working directories',
  create: 'Use an isolated working directory', requested: 'Create a working directory when the next task starts', cancel: 'Cancel creation', stop: 'Stop creation', retry: 'Retry',
  restore: 'Restore working directory', leave: 'Return to original project', missing: 'Working directory is missing. Restore recovers committed content only.',
  prepare: 'Preparing working directory', checkout: 'Checking out files', failed: 'Working directory operation failed',
  original: 'Original project', current: 'Execution directory', branch: 'Branch changes', uncommitted: 'Uncommitted', staged: 'Staged', unstaged: 'Unstaged',
  refresh: 'Refresh diff', empty: 'No local changes', files: 'Changed files', binary: 'Binary file', oversized: 'File is too large to preview',
  disconnected: 'Connection lost', unavailable: 'Unable to read local changes', actionDone: 'Action completed', actionFailed: 'Action failed. Try again.',
  omitted: 'Some untracked files are omitted', readonly: 'This session is read-only', notGit: 'This directory is not a Git project',
} satisfies Record<ForgePanelKey, string>
