/**
 * Typed locale dictionary for the interactive terminal user interface.
 * Supports Chinese (default) and English.
 *
 * @module @deepseek-ai/dsh-tui/locales
 */

export interface LocaleDictionary {
  readonly appTitle: string
  readonly statusIdle: string
  readonly statusRunning: string
  readonly statusCancelling: string
  readonly statusWaitingApproval: string
  readonly statusWaitingQuestion: string
  readonly statusExiting: string
  readonly inputPlaceholder: string
  readonly inputHint: string
  readonly multilineHint: string
  readonly bracketedPasteNotice: string
  readonly approvalTitle: string
  readonly approvalTool: string
  readonly approvalReason: string
  readonly approvalArgs: string
  readonly approvalArgsUnavailable: string
  readonly approvalOptionAllow: string
  readonly approvalOptionReject: string
  readonly approvalOptionCancel: string
  readonly approvalEnterWarning: string
  readonly questionTitle: string
  readonly questionSingleChoiceHint: string
  readonly questionMultiChoiceHint: string
  readonly questionSubmitHint: string
  readonly questionCustomPrompt: string
  readonly approvalOutcomeAllowed: string
  readonly approvalOutcomeRejected: string
  readonly approvalOutcomeCancelled: string
  readonly questionAnswerSelected: string
  readonly questionAnswerCustom: string
  readonly questionProgress: string
  readonly questionInvalidChoice: string
  readonly modelCurrent: string
  readonly modelSelectPrompt: string
  readonly modelSwitchNotice: string
  readonly modelUnknownError: string
  readonly modelEffortInvalidError: string
  readonly draftQueuedNotice: string
  readonly pendingTurnBusyError: string
  readonly sessionCurrent: string
  readonly sessionWorkspace: string
  readonly sessionListHeader: string
  readonly sessionNoHistory: string
  readonly sessionCreated: string
  readonly sessionResumed: string
  readonly sessionConflictError: string
  readonly commandHelpTitle: string
  readonly commandHelpText: string
  readonly errorTtyRequired: string
  readonly errorOperationFailed: string
  readonly exitGoodbye: string
  readonly scrollbackTruncationNotice: string
}

const ZH_LOCALE: LocaleDictionary = {
  appTitle: 'DeepSeek Harness 终端交互前端 (TUI)',
  statusIdle: '空闲',
  statusRunning: '运行中...',
  statusCancelling: '正在取消...',
  statusWaitingApproval: '待审批',
  statusWaitingQuestion: '待回答问题',
  statusExiting: '正在退出...',
  inputPlaceholder: '输入提示词或 /help 查看命令 (Enter 发送, Alt+Enter 换行)',
  inputHint: '[Enter 提交 | Alt+Enter 换行 | Ctrl+C 取消/清空 | /help 帮助]',
  multilineHint: '多行输入模式：按 Alt+Enter 换行，Enter 提交',
  bracketedPasteNotice: '[已贴入剪贴板内容，请复核后按 Enter 提交]',
  approvalTitle: '【敏感操作审批】',
  approvalTool: '调用工具',
  approvalReason: '申请理由',
  approvalArgs: '参数摘要',
  approvalArgsUnavailable: '参数不可读取或日志不匹配（禁止直接批准）',
  approvalOptionAllow: '[y] 批准单次执行',
  approvalOptionReject: '[n] 拒绝执行',
  approvalOptionCancel: '[c] 取消当前任务',
  approvalEnterWarning: '请明确输入 y/n/c 确认（按 Enter 默认不批准）',
  questionTitle: '【用户问题】',
  questionSingleChoiceHint: '使用数字键或方向键选择一个选项后按 Enter',
  questionMultiChoiceHint: '输入逗号分隔的数字或按空格切换多选，按 Enter 确认',
  questionSubmitHint: '按 Enter 提交当前选择',
  questionCustomPrompt: '或输入自定义回答：',
  approvalOutcomeAllowed: '已批准执行',
  approvalOutcomeRejected: '已拒绝执行',
  approvalOutcomeCancelled: '已取消任务',
  questionAnswerSelected: '已选择',
  questionAnswerCustom: '已输入自定义回答',
  questionProgress: '问题',
  questionInvalidChoice: '无效的选择，请重新输入',
  modelCurrent: '当前模型',
  modelSelectPrompt: '输入模型名称或编号切换模型：',
  modelSwitchNotice: '模型已切换为',
  modelUnknownError: '未知模型或提供商',
  modelEffortInvalidError: '无效的推理努力程度（必须为 low, medium, high 或 default）',
  draftQueuedNotice: '[轮次进行中：提示词已入队，待空闲自动执行]',
  pendingTurnBusyError: '轮次进行中：等待队列已满，请等待完成',
  sessionCurrent: '当前会话',
  sessionWorkspace: '工作区',
  sessionListHeader: '已保存会话列表：',
  sessionNoHistory: '无历史会话',
  sessionCreated: '新建会话成功',
  sessionResumed: '恢复会话成功',
  sessionConflictError: '会话被另一个进程占用锁（Session Already Owned），请等待或使用其他会话',
  commandHelpTitle: '可用命令帮助：',
  commandHelpText: [
    '  /help            显示此帮助信息',
    '  /new             开始一个新会话',
    '  /resume <id>     恢复指定的历史会话',
    '  /sessions        查看历史会话列表',
    '  /model <name>    查看或切换当前使用的模型',
    '  /clear           清空当前屏幕显示',
    '  /quit            退出 TUI 前端',
  ].join('\n'),
  errorTtyRequired: 'TUI 必须运行于交互式 TTY 终端；非交互式运行请使用 dsh --profile headless',
  errorOperationFailed: '操作执行失败',
  exitGoodbye: '终端状态已还原，再见！',
  scrollbackTruncationNotice: '... [已截断超出单行限制内容]',
}

const EN_LOCALE: LocaleDictionary = {
  appTitle: 'DeepSeek Harness Terminal User Interface (TUI)',
  statusIdle: 'IDLE',
  statusRunning: 'RUNNING...',
  statusCancelling: 'CANCELLING...',
  statusWaitingApproval: 'WAITING APPROVAL',
  statusWaitingQuestion: 'WAITING QUESTION',
  statusExiting: 'EXITING...',
  inputPlaceholder: 'Type a prompt or /help (Enter to send, Alt+Enter for newline)',
  inputHint: '[Enter submit | Alt+Enter newline | Ctrl+C cancel/clear | /help help]',
  multilineHint: 'Multiline edit: Alt+Enter for newline, Enter to submit',
  bracketedPasteNotice: '[Pasted content inserted; review and press Enter to submit]',
  approvalTitle: '[Tool Execution Approval]',
  approvalTool: 'Tool',
  approvalReason: 'Reason',
  approvalArgs: 'Arguments',
  approvalArgsUnavailable: 'Arguments unavailable or mismatch (approval forbidden)',
  approvalOptionAllow: '[y] Allow once',
  approvalOptionReject: '[n] Reject',
  approvalOptionCancel: '[c] Cancel turn',
  approvalEnterWarning: 'Explicitly type y/n/c to confirm (Enter does not approve)',
  questionTitle: '[User Question]',
  questionSingleChoiceHint: 'Select an option with number or arrows then Enter',
  questionMultiChoiceHint: 'Enter comma-separated numbers or space to toggle, then Enter',
  questionSubmitHint: 'Press Enter to submit choice',
  questionCustomPrompt: 'Or enter custom response:',
  approvalOutcomeAllowed: 'Execution allowed',
  approvalOutcomeRejected: 'Execution rejected',
  approvalOutcomeCancelled: 'Task cancelled',
  questionAnswerSelected: 'Selected',
  questionAnswerCustom: 'Custom response',
  questionProgress: 'Question',
  questionInvalidChoice: 'Invalid choice, please re-enter',
  modelCurrent: 'Current Model',
  modelSelectPrompt: 'Enter model name or index to switch:',
  modelSwitchNotice: 'Model switched to',
  modelUnknownError: 'Unknown model or provider',
  modelEffortInvalidError: 'Invalid reasoning effort (must be low, medium, high, or default)',
  draftQueuedNotice: '[Turn in progress: draft queued until agent idle]',
  pendingTurnBusyError: 'Turn in progress: pending queue is full, please wait for idle',
  sessionCurrent: 'Session',
  sessionWorkspace: 'Workspace',
  sessionListHeader: 'Saved Sessions:',
  sessionNoHistory: 'No saved sessions found',
  sessionCreated: 'Created new session',
  sessionResumed: 'Resumed session',
  sessionConflictError: 'Session is locked by another process (Session Already Owned)',
  commandHelpTitle: 'Available Commands:',
  commandHelpText: [
    '  /help            Show this help information',
    '  /new             Start a fresh session',
    '  /resume <id>     Resume a persisted session',
    '  /sessions        List persisted sessions',
    '  /model <name>    Inspect or switch active model',
    '  /clear           Clear current terminal output',
    '  /quit            Exit TUI frontend',
  ].join('\n'),
  errorTtyRequired: 'TUI requires an interactive TTY; for non-interactive execution, run dsh --profile headless',
  errorOperationFailed: 'Operation failed',
  exitGoodbye: 'Terminal state restored. Goodbye!',
  scrollbackTruncationNotice: '... [Truncated oversized line]',
}

/**
 * Get the locale dictionary for the requested language code.
 * @param locale - 'zh' or 'en'.
 * @returns The matching LocaleDictionary.
 */
export function getLocale(locale: 'zh' | 'en' = 'zh'): LocaleDictionary {
  return locale === 'en' ? EN_LOCALE : ZH_LOCALE
}
