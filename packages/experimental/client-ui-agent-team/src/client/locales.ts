/** Agent Teams Web dictionaries. */

/** Locale namespace owned by the Agent Teams Web UI. */
export const NS = 'agent-team'

/** Simplified Chinese dictionary and key source. */
export const zh = {
  trigger: '团队协作',
  brand: 'Agent Team',
  refresh: '刷新名单',
  close: '关闭',
  loading: '正在加载团队…',
  empty: '还没有共享任务',
  roster: '成员',
  rosterHint:
    '常驻队友可反复派活并保留上下文。在对话里让主助理组建团队即可；临时子任务（子代理）做完即结束，不会出现在这个名单里。',
  howToUse: '在对话里指挥主助理即可，不必记工具名。点下方按钮可把启动话术填入输入框（不会自动发送）。',
  templatesTitle: '填入启动话术',
  'template.researcher.label': '建调研队友',
  'template.researcher.body':
    '用团队协作：建一个叫 researcher 的常驻队友，让它只做调研并回报结论；建好后列出当前队友。',
  'template.squad.label': '建协作小队',
  'template.squad.body':
    '用团队协作：建两个常驻队友——researcher（调研）和 writer（整理结论）。先让 researcher 查清现状，再让 writer 汇总成简短结论，最后列出队友状态。',
  'template.list.label': '列出队友',
  'template.list.body': '列出当前团队协作的主助理与所有常驻队友及其状态。',
  tasks: '共享任务',
  model: '模型',
  open: '打开队友会话',
  create: '新建任务',
  subject: '任务标题',
  description: '任务描述',
  blockers: '依赖任务 id（逗号分隔）',
  scopes: '写入范围（逗号分隔）',
  save: '保存',
  cancel: '取消',
  edit: '编辑',
  complete: '完成',
  reopen: '重开',
  delete: '删除',
  owner: '负责人',
  unowned: '未分配',
  blockedBy: '依赖',
  writeScopes: '写入范围',
  ready: '可开始',
  blocked: '被依赖阻塞',
  conflict: '任务状态已变化，已重新加载；请检查后重试。',
  'role.lead': '主助理',
  'role.teammate': '常驻队友',
  'memberStatus.running': '运行中',
  'memberStatus.idle': '空闲',
  'memberStatus.inactive': '未运行',
  'memberStatus.provisioning': '准备中',
  'memberStatus.failed': '失败',
  'result.completed': '已完成',
  'result.failed': '失败',
  'status.pending': '待处理',
  'status.in_progress': '进行中',
  'status.completed': '已完成',
} satisfies Record<string, string>

/** Agent Teams locale key union. */
export type TeamKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  trigger: 'Team',
  brand: 'Agent Team',
  refresh: 'Refresh roster',
  close: 'Close',
  loading: 'Loading team…',
  empty: 'No shared tasks yet',
  roster: 'Members',
  rosterHint:
    'Teammates stay on the roster and keep context across jobs. Ask the lead in chat to form a team; one-shot subagents finish and never appear here.',
  howToUse: 'Steer the lead in chat — you do not need tool names. Use the buttons below to fill a starter prompt into the composer (nothing is sent automatically).',
  templatesTitle: 'Fill a starter prompt',
  'template.researcher.label': 'Spawn researcher',
  'template.researcher.body':
    'Use Team: spawn a durable teammate named researcher to investigate and report back; then list the current teammates.',
  'template.squad.label': 'Spawn a small squad',
  'template.squad.body':
    'Use Team: spawn two durable teammates — researcher (investigate) and writer (summarize). Have researcher gather the facts first, then writer produce a short summary, then list teammate status.',
  'template.list.label': 'List teammates',
  'template.list.body': 'List the Team lead and every durable teammate with their current status.',
  tasks: 'Shared tasks',
  model: 'Model',
  open: 'Open teammate conversation',
  create: 'New task',
  subject: 'Task subject',
  description: 'Task description',
  blockers: 'Blocking task ids (comma separated)',
  scopes: 'Write scopes (comma separated)',
  save: 'Save',
  cancel: 'Cancel',
  edit: 'Edit',
  complete: 'Complete',
  reopen: 'Reopen',
  delete: 'Delete',
  owner: 'Owner',
  unowned: 'Unowned',
  blockedBy: 'Blocked by',
  writeScopes: 'Write scopes',
  ready: 'Ready',
  blocked: 'Blocked by dependencies',
  conflict: 'Task state changed and was reloaded. Review it before retrying.',
  'role.lead': 'Lead',
  'role.teammate': 'Teammate',
  'memberStatus.running': 'Running',
  'memberStatus.idle': 'Idle',
  'memberStatus.inactive': 'Inactive',
  'memberStatus.provisioning': 'Provisioning',
  'memberStatus.failed': 'Failed',
  'result.completed': 'Completed',
  'result.failed': 'Failed',
  'status.pending': 'Pending',
  'status.in_progress': 'In progress',
  'status.completed': 'Completed',
} satisfies Record<TeamKey, string>

/** Starter prompt templates offered from the Team panel (fill composer only). */
export const STARTER_TEMPLATES = [
  'researcher',
  'squad',
  'list',
] as const

/** One starter-template id. */
export type StarterTemplateId = (typeof STARTER_TEMPLATES)[number]
