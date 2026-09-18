/** Agent Teams Web dictionaries. */

/** Locale namespace owned by the Agent Teams Web UI. */
export const NS = 'agent-team'

/** Simplified Chinese dictionary and key source. */
export const zh = {
  trigger: '团队协作',
  triggerHint: '打开右侧协作舱：上方看关系图，下方管任务。有队友时顶栏显示人数徽章。',
  triggerBadge: '团队协作，{count} 名队友',
  triggerBadgeRunning: '团队协作，{running}/{count} 名队友运行中',
  brand: 'Agent Team',
  refresh: '刷新名单',
  close: '关闭',
  pin: '钉住舱',
  unpin: '取消钉住',
  resize: '拖拽调整舱宽',
  loading: '正在加载团队…',
  empty: '还没有共享任务',
  roster: '成员',
  rosterHint:
    '机构常驻小队从首页进入：编制先于对话，点小队是把活派给还在的队。下面名单是这支队的常驻队友。现组仍可在对话里临时组建；一次性子代理做完即结束，不会出现在这里。',
  howToUse:
    '右侧舱上方是协作关系，下方是成员与共享任务。机构常驻从首页派活；现组用底部话术在对话里临时组建（只填入，不自动发送）。',
  squadsTitle: '机构常驻',
  squadsHint: '编制先于对话。点小队是把活派给这支还在的队，不会再组一次。',
  squadsNeedWorkspace: '先选工作区，再派活给常驻小队。',
  'squad.document': '文书组',
  'squad.case': '案例组',
  'squad.comms': '传播部',
  squadEstablished: '已在编',
  squadReady: '待派活',
  squadDispatch: '派活给这支队',
  squadDispatching: '正在打开小队…',
  squadSeats: '编制座位',
  squadFollowLead: '跟随主助理',
  squadSeatCount: '{count} 个座位',
  'seat.archivist': '资料员',
  'seat.drafter': '文书员',
  'seat.metric-checker': '指标核对员',
  'seat.reviewer': '审核员',
  'seat.notetaker': '记录整理员',
  'seat.redactor': '脱敏员',
  'seat.case-writer': '案例萃取员',
  'seat.librarian': '入库审核员',
  'seat.sourcer': '资料员',
  'seat.outliner': '结构员',
  'seat.copywriter': '写作员',
  'seat.compliance-reviewer': '审核员',
  opsTitle: '任务与成员',
  opsCollapse: '收起',
  opsExpand: '展开',
  archifyCtaTitle: '任务已全部完成',
  archifyCtaHint: '点一下生成协作总结图（填入并发送）。跑完后路径会自动回填并刷新预览。',
  archifyCtaAction: '生成协作总结图',
  archifyCtaDismiss: '稍后',
  'archify.prompt':
    '加载 archify skill。根据本会话 Agent Team 的真实成员、任务依赖与消息往来，'
    + '生成一张「小队协作流水线」架构图 HTML（节点=成员，边=任务/消息），'
    + '保存到当前工作区。不要重新跑任务，不要编造成员或边。'
    + '交付成功标准：HTML 已写入磁盘，且回复最后一行严格为 ARCHIFY_HTML_PATH: <文件路径>。'
    + 'visual-check / Chrome 截图在桌面沙箱里常不可用：跳过或失败时不要写成交付失败，只需说明「自动截图不可用，请在总结图页查看」。'
    + '回复里给出可点击路径，并且最后一行必须严格为：ARCHIFY_HTML_PATH: <文件路径>',
  tabLive: '协作',
  tabSummary: '总结图',
  archifySummaryTitle: '总结图',
  archifySummaryHint:
    '事后 Archify HTML。点生成后，助理回复里的 ARCHIFY_HTML_PATH 会自动回填并加载预览；也可手动改路径或用浏览器打开。',
  archifyPathPlaceholder: 'HTML 路径（自动回填）',
  archifyLoadPreview: '加载预览',
  archifyOpenBrowser: '用浏览器打开',
  archifyPreviewFailed: '预览失败',
  archifyPreviewEmpty: '还没有可预览的 HTML',
  archifyGenerating: '已填入并发送…',
  archifySummaryCtaHint: '一点即发送；完成后自动回填路径并刷新预览。',
  topology: '协作关系',
  topologyHint: '与名单同一份数据：成员状态、消息往来边、任务依赖边；不含消息正文。舱打开时约每 1.5 秒自动刷新；也可手动刷新。',
  topologyShow: '显示关系图',
  topologyHide: '隐藏关系图',
  topologyEmpty: '组好队友或建立带负责人的任务依赖后，这里会显示关系。',
  topologyEdgeMessage: '消息',
  topologyEdgeTask: '任务依赖',
  motionReduce: '减弱动态',
  motionFull: '完整动态',
  templatesTitle: '现组：填入启动话术',
  'template.document.label': '组文书项目组',
  'template.document.body':
    '用团队协作，按机构「文书项目组」组建常驻队友（name 必须是英文 lower-kebab-case，括号内是中文职责）：\n'
    + '- name=archivist（资料员）：只收材料、建索引、列缺失项，不编数据\n'
    + '- name=drafter（文书员）：按模板出结构完整初稿；无来源章节只写「缺失项清单」\n'
    + '- name=metric-checker（指标核对员）：对照原始表核数字/单位/目标达成，出差异清单\n'
    + '- name=reviewer（审核员）：查对外承诺、财务敏感、口径风险；不替机构提交资方\n'
    + '我是主控：先问清立项书/结项/资助信，再建共享任务（依赖 + 写入范围），按 archivist→drafter→metric-checker→reviewer 串行。你负责分派与收口，不要自己写终稿；禁止估算或编造预算、人数、成效。建好后列出队友状态，等我提供材料再开工。',
  'template.case.label': '组案例档案组',
  'template.case.body':
    '用团队协作，按机构「案例档案组」组建常驻队友（name 用英文 kebab，括号为中文职责）：\n'
    + '- name=notetaker（记录整理员）：忠实整理现场/访谈笔记，不润色事实\n'
    + '- name=redactor（脱敏员）：去姓名手机身份证，地址不超过区县\n'
    + '- name=case-writer（案例萃取员）：做成标准案例卡（背景-行动-结果-手法）\n'
    + '- name=librarian（入库审核员）：五分类归档并更新索引，缺字段标待补\n'
    + '主控按 notetaker→redactor→case-writer→librarian 建共享任务依赖；脱敏未完成前禁止对外传播口径。数字与事实只来自材料。建好后列队友，等我丢原始笔记再开工。',
  'template.comms.label': '组传播协作组',
  'template.comms.body':
    '用团队协作，按机构「传播部」组建常驻队友（name 用英文 kebab，括号为中文职责）：\n'
    + '- name=sourcer（资料员）：汇素材与口径边界（含脱敏要求）\n'
    + '- name=outliner（结构员）：定标题/提纲/段落结构\n'
    + '- name=copywriter（写作员）：出「说人话」初稿，不编成效数字\n'
    + '- name=compliance-reviewer（审核员）：发布前审校敏感信息与过度承诺；不代发微信/平台\n'
    + '主控先确认活动复盘推文、招募包或节点宣发，再按 sourcer→outliner→copywriter→compliance-reviewer 派共享任务。你分派与收口，不写终稿。建好后列队友，等我给活动材料再开工。',
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
  triggerHint: 'Opens the right collaboration dock: map on top, tasks below. Teammate count shows on the header badge.',
  triggerBadge: 'Team, {count} teammates',
  triggerBadgeRunning: 'Team, {running}/{count} teammates running',
  brand: 'Agent Team',
  refresh: 'Refresh roster',
  close: 'Close',
  pin: 'Pin dock',
  unpin: 'Unpin dock',
  resize: 'Drag to resize dock',
  loading: 'Loading team…',
  empty: 'No shared tasks yet',
  roster: 'Members',
  rosterHint:
    'Standing institution squads start on the home page: the roster exists before chat, and opening a squad assigns work to that living team. This list is those standing teammates. Ad-hoc teams can still be formed in chat; one-shot subagents finish and never appear here.',
  howToUse:
    'The right dock shows the collaboration map above and roster/tasks below. Standing squads are dispatched from home. Ad-hoc starter buttons only fill the composer — nothing is sent automatically.',
  squadsTitle: 'Standing squads',
  squadsHint: 'The roster exists before chat. Opening a squad assigns work to that living team — it does not spawn a new one.',
  squadsNeedWorkspace: 'Choose a workspace first, then dispatch a standing squad.',
  'squad.document': 'Document squad',
  'squad.case': 'Case squad',
  'squad.comms': 'Comms squad',
  squadEstablished: 'Standing',
  squadReady: 'Ready to dispatch',
  squadDispatch: 'Assign work to this squad',
  squadDispatching: 'Opening squad…',
  squadSeats: 'Roster seats',
  squadFollowLead: 'Follow the lead model',
  squadSeatCount: '{count} seats',
  'seat.archivist': 'Archivist',
  'seat.drafter': 'Drafter',
  'seat.metric-checker': 'Metric checker',
  'seat.reviewer': 'Reviewer',
  'seat.notetaker': 'Notetaker',
  'seat.redactor': 'Redactor',
  'seat.case-writer': 'Case writer',
  'seat.librarian': 'Librarian',
  'seat.sourcer': 'Sourcer',
  'seat.outliner': 'Outliner',
  'seat.copywriter': 'Copywriter',
  'seat.compliance-reviewer': 'Compliance reviewer',
  opsTitle: 'Tasks & members',
  opsCollapse: 'Collapse',
  opsExpand: 'Expand',
  archifyCtaTitle: 'All tasks completed',
  archifyCtaHint: 'One click fills and sends Archify. When done, the path autofills and the preview refreshes.',
  archifyCtaAction: 'Generate collaboration diagram',
  archifyCtaDismiss: 'Later',
  'archify.prompt':
    'Load the archify skill. From this session’s Agent Team members, task dependencies, and message edges, '
    + 'produce a squad-pipeline architecture HTML (nodes = members, edges = tasks/messages), '
    + 'save it in the workspace. Do not re-run tasks or invent members/edges. '
    + 'Success means the HTML is on disk and the last reply line is exactly ARCHIFY_HTML_PATH: <file-path>. '
    + 'visual-check / Chrome screenshots often fail in the desktop sandbox: if skipped or failed, do not call delivery a failure — say screenshots are unavailable and the Summary tab preview is the review surface. '
    + 'Reply with a clickable path, and end with exactly: ARCHIFY_HTML_PATH: <file-path>',
  tabLive: 'Live',
  tabSummary: 'Summary',
  archifySummaryTitle: 'Summary diagram',
  archifySummaryHint:
    'Post-hoc Archify HTML. After generate, ARCHIFY_HTML_PATH from the assistant reply autofills and loads the preview; you can still edit the path or open in the browser.',
  archifyPathPlaceholder: 'HTML path (autofilled)',
  archifyLoadPreview: 'Load preview',
  archifyOpenBrowser: 'Open in browser',
  archifyPreviewFailed: 'Preview failed',
  archifyPreviewEmpty: 'No HTML to preview yet',
  archifyGenerating: 'Filled and sent…',
  archifySummaryCtaHint: 'One click sends; path autofills and preview refreshes when done.',
  topology: 'Collaboration map',
  topologyHint: 'Same TeamView as the roster: member status, message edges, and task-dependency edges — no message bodies. Soft-refreshes about every 1.5s while the dock is open; manual refresh still works.',
  topologyShow: 'Show map',
  topologyHide: 'Hide map',
  topologyEmpty: 'Spawn teammates or claim dependent tasks to see relationships here.',
  topologyEdgeMessage: 'message',
  topologyEdgeTask: 'task dep',
  motionReduce: 'Reduce motion',
  motionFull: 'Full motion',
  templatesTitle: 'Ad-hoc: fill a starter prompt',
  'template.document.label': 'Document project squad',
  'template.document.body':
    'Use Team. Form an institutional document squad (machine name must be lower-kebab-case; Chinese role in parentheses):\n'
    + '- name=archivist (资料员): gather materials, index, list gaps; never invent data\n'
    + '- name=drafter (文书员): draft from the template; missing sources go to a gap list\n'
    + '- name=metric-checker (指标核对员): reconcile numbers/units/targets against source tables\n'
    + '- name=reviewer (审核员): check external promises and financial sensitivity; do not submit to funders\n'
    + 'I am Lead: clarify proposal vs closure vs grant letter, then create shared tasks with dependencies and write scopes in order archivist→drafter→metric-checker→reviewer. You coordinate and close out; do not write the final draft yourself; never invent budget, headcount, or outcomes. List teammates when ready and wait for my materials.',
  'template.case.label': 'Case archive squad',
  'template.case.body':
    'Use Team. Form a case-archive squad (lower-kebab-case names; Chinese roles in parentheses):\n'
    + '- name=notetaker (记录整理员): faithful notes only\n'
    + '- name=redactor (脱敏员): strip PII; address no finer than district\n'
    + '- name=case-writer (案例萃取员): standard case card (context-action-result-method)\n'
    + '- name=librarian (入库审核员): five-way archive + index; mark missing fields\n'
    + 'Lead: shared tasks notetaker→redactor→case-writer→librarian; no external messaging before redaction. Facts only from materials. List teammates and wait for raw notes.',
  'template.comms.label': 'Comms squad',
  'template.comms.body':
    'Use Team. Form a communications squad (lower-kebab-case names; Chinese roles in parentheses):\n'
    + '- name=sourcer (资料员): materials and messaging boundaries including redaction\n'
    + '- name=outliner (结构员): title, outline, section plan\n'
    + '- name=copywriter (写作员): plain-language draft; no invented outcome numbers\n'
    + '- name=compliance-reviewer (审核员): pre-publish review; do not post to WeChat/platforms\n'
    + 'Lead: confirm recap post vs recruit pack vs calendar campaign, then tasks sourcer→outliner→copywriter→compliance-reviewer. Coordinate only; do not write the final draft. List teammates and wait for activity materials.',
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
  'document',
  'case',
  'comms',
] as const

/** One starter-template id. */
export type StarterTemplateId = (typeof STARTER_TEMPLATES)[number]
