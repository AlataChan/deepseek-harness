/**
 * User-visible Chinese and English copy for the ask-knowledge overlay.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/client/locales
 */

/** Overlay dictionary keys. */
export type AskKnowledgeKey =
  | 'chip.unbound'
  | 'picker.title'
  | 'picker.summary'
  | 'picker.rulesToggle'
  | 'picker.empty'
  | 'picker.loading'
  | 'picker.typeLibrary'
  | 'picker.documentCount'
  | 'picker.leadAskData'
  | 'picker.leadLibrary'
  | 'picker.leadPreset'
  | 'picker.leadDataMode'
  | 'picker.leadThicken'
  | 'picker.addDocument'
  | 'picker.remove'
  | 'picker.close'
  | 'picker.emptyCreate'
  | 'picker.create'
  | 'picker.uploadTitle'
  | 'picker.uploadLead'
  | 'picker.chooseFile'
  | 'picker.selectFile'
  | 'picker.docsTitle'
  | 'picker.docsLead'
  | 'picker.docsEmpty'
  | 'picker.docsHang'
  | 'picker.docsWhole'
  | 'picker.back'
  | 'dock.title'
  | 'dock.docsOne'
  | 'dock.docsMany'
  | 'dock.change'
  | 'picker.skipEmpty'
  | 'batchQueued'
  | 'batchRunning'
  | 'batchDone'
  | 'settings.addDocuments'
  | 'settings.addedDocuments'
  | 'settings.section'
  | 'settings.remove'
  | 'settings.removeFailed'
  | 'error.noKey'
  | 'error.terms'
  | 'error.unbound'
  | 'error.unsupportedType'
  | 'error.emptyPick'
  | 'error.docsFailed'
  | 'ingest.converting'
  | 'ingest.proposing'
  | 'ingest.applying'
  | 'ingest.timeout'
  | 'ingest.retained'
  | 'ingest.deferred'
  | 'ingest.failed'
  | 'docs.estimate'
  | 'docs.statusCancelled'
  | 'docs.partialConversion'
  | 'docs.migrationWarning'
  | 'docs.title'
  | 'docs.originalSaved'
  | 'docs.originalUnavailable'
  | 'docs.textSearchable'
  | 'docs.searchableWithProgress'
  | 'docs.partialNeedsOcr'
  | 'docs.openOriginal'
  | 'docs.viewExtracted'
  | 'docs.viewSources'
  | 'docs.retryStage'
  | 'docs.uncertainWarning'
  | 'docs.replayUncertain'
  | 'docs.resumeExtraction'
  | 'docs.cancelProcessing'
  | 'docs.approvedEstimate'
  | 'docs.estimateLabel'
  | 'docs.approveBudget'
  | 'docs.budgetApproved'
  | 'docs.loading'
  | 'docs.empty'
  | 'docs.statusConverting'
  | 'docs.statusChunking'
  | 'docs.statusEnriching'
  | 'docs.statusAwaitingApproval'
  | 'docs.statusWikiIncomplete'
  | 'docs.usage'
  | 'docs.usagePartial'
  | 'docs.chunksWithoutPages'
  | 'docs.retryRequired'
  | 'docs.statusPaused'
  | 'docs.statusFailed'
  | 'docs.statusCompleted'

/** Chinese copy for the ask-knowledge chip, picker, settings, and ingest. */
const zh = {
  'chip.unbound': '问知识',
  'picker.title': '选一个知识库',
  'picker.summary': '挂上一个可复用的文档库；表格请走问数据。',
  'picker.rulesToggle': '规则',
  'picker.empty': '还没有知识库。新建一个，或先空着开始提问。',
  'picker.loading': '正在加载知识库',
  'picker.typeLibrary': '文档库',
  'picker.documentCount': '{count} 篇',
  'picker.leadAskData': '问数据是这一次问一张表，问完锁在这个会话。',
  'picker.leadLibrary': '知识库是问一套会变厚的材料，换会话还能用。',
  'picker.leadPreset': '挂上库不是换成另一种助理，默认仍是标准模式，只是多了检索工具。',
  'picker.leadDataMode': '当前是数据模式时，点库名会新开一个标准会话再挂上。数据模式只问表，不会按知识库问答。',
  'picker.leadThicken': '点库名挂到这个会话。点添加文档，往这个库再放一份材料。点删除，从名单去掉。',
  'picker.addDocument': '添加文档',
  'picker.remove': '删除',
  'picker.close': '关闭知识库',
  'picker.emptyCreate': '+ 新建知识库',
  'picker.create': '未命名知识库',
  'picker.uploadTitle': '上传本地文档',
  'picker.uploadLead': '选一份文档写进这个知识库。可以用 .md、.txt、.html、.pdf、.docx、.csv、.json、.xlsx。表格更适合走问数据。',
  'picker.chooseFile': '选择本地文档',
  'picker.selectFile': '从库中选文件',
  'picker.docsTitle': '库内文档',
  'picker.docsLead': '勾选要挂载的文档，或挂整个库。挂上后可在对话栏看到。',
  'picker.docsEmpty': '这个库还没有文档。先添加文档，或直接挂整个库。',
  'picker.docsHang': '挂载所选文档',
  'picker.docsWhole': '挂载整个库',
  'picker.back': '返回',
  'dock.title': '问知识',
  'dock.docsOne': '已选：{name}',
  'dock.docsMany': '已选：{name} 等 {count} 篇',
  'dock.change': '更换',
  'picker.skipEmpty': '先空着，直接提问',
  batchQueued: '排队中',
  batchRunning: '正在处理',
  batchDone: '已入库',
  'settings.addDocuments': '添加文档',
  'settings.addedDocuments': '已添加 {count} 份文档，可在下方查看处理状态',
  'settings.section': '我的知识库',
  'settings.remove': '从名单移除',
  'settings.removeFailed': '没能从名单移除。',
  'error.noKey': '还没有 API Key',
  'error.terms': '请改用 1 到 6 个专名，不要整句。',
  'error.unbound': '先在上方挂上一个知识库。',
  'error.unsupportedType': '这种文件还不能入库。请用 .md、.txt、.html、.pdf、.docx、.csv、.json 或 .xlsx。',
  'error.emptyPick': '没有读到所选文件，请再选一次。',
  'error.docsFailed': '没能读出这个库的文档，请稍后再试。',
  'ingest.converting': '正在转换文档',
  'ingest.proposing': '正在整理成词条',
  'ingest.applying': '正在写入知识库，可能需要几分钟。',
  'ingest.timeout': '整理这份文档超过了等待时间。请再试一次。',
  'ingest.retained': '原件和全文已保存，可直接提问；可在设置的“我的知识库”批准整理预算。',
  'ingest.deferred': '这次没有写进去，需要人工确认后才能入库。',
  'ingest.failed': '文档没有写进知识库。',
  'docs.estimate': '完整文档批准额度上限（保守估算，非预计实际消耗）：{tokens} token，{chunks} 段。批准后才会请求模型。',
  'docs.approvedEstimate': '已批准额度上限（保守估算）：{tokens} token，{chunks} 段。实际用量以模型服务报告为准。',
  'docs.statusCancelled': '处理已取消；已有文件保留。',
  'docs.partialConversion': '部分文本；原件可能还有未提取内容',
  'docs.migrationWarning': '旧文档登记失败，已登记文档仍可使用。本次启动不再自动重试；排除问题后请重启应用。详情：{error}',
  'docs.title': '库内文档管理',
  'docs.originalSaved': '原始文件已保存',
  'docs.originalUnavailable': '原始文件不可用',
  'docs.textSearchable': '文本可检索',
  'docs.searchableWithProgress': '文本可检索；知识提取 {completed}/{total} 块',
  'docs.partialNeedsOcr': '部分文本：第 {page} 页需要 OCR',
  'docs.openOriginal': '打开原始文件',
  'docs.viewExtracted': '查看提取文本',
  'docs.viewSources': '查看来源',
  'docs.retryStage': '重试失败步骤',
  'docs.uncertainWarning': '上次模型调用的结果不确定，可能已消耗额度。确认重新尝试将再次调用模型并使用额度；不会自动重试。',
  'docs.replayUncertain': '确认重新调用模型（使用额度）',
  'docs.resumeExtraction': '继续提取',
  'docs.cancelProcessing': '取消处理',
  'docs.estimateLabel': '预计消耗: ~{tokens} 词元',
  'docs.approveBudget': '批准预算',
  'docs.budgetApproved': '已批准',
  'docs.loading': '正在加载文档…',
  'docs.empty': '该知识库暂无文档',
  'docs.statusConverting': '正在转换格式',
  'docs.statusChunking': '正在分块规划',
  'docs.statusEnriching': '正在提取知识',
  'docs.statusAwaitingApproval': '等待批准预算',
  'docs.statusWikiIncomplete': '处理已结束；Wiki覆盖待核验',
  'docs.usage': '模型报告实际用量：{tokens} token。',
  'docs.usagePartial': '已知实际用量：{tokens} token；部分请求未报告用量。',
  'docs.chunksWithoutPages': '{chunks} 段未产生知识页（可能为重复内容）；不代表所有事实均已进入 Wiki。',
  'docs.retryRequired': '该次模型回复无法采用。请重试失败步骤，并重新确认新增请求的预算。',
  'docs.statusPaused': '提取已暂停',
  'docs.statusFailed': '处理失败',
  'docs.statusCompleted': '提取完成',
} as const satisfies Record<AskKnowledgeKey, string>

/** English copy for the ask-knowledge chip, picker, settings, and ingest. */
const en = {
  'chip.unbound': 'Ask knowledge',
  'picker.title': 'Choose a knowledge library',
  'picker.summary': 'Hang a reusable document library. Spreadsheets belong in ask-data.',
  'picker.rulesToggle': 'Rules',
  'picker.empty': 'No knowledge libraries yet. Create one, or skip and ask with an empty library.',
  'picker.loading': 'Loading knowledge libraries',
  'picker.typeLibrary': 'Document library',
  'picker.documentCount': '{count} docs',
  'picker.leadAskData': 'Ask-data asks one table in this session and stays locked here.',
  'picker.leadLibrary': 'A knowledge library thickens over time and can be reused in other sessions.',
  'picker.leadPreset': 'Hanging a library does not change the assistant. Standard mode stays; retrieve tools are added.',
  'picker.leadDataMode': 'If this chat is in data mode, clicking a name opens a new standard session and hangs the library there. Data mode only asks tables and will not retrieve from the library.',
  'picker.leadThicken': 'Click a name to hang it. Add a document to put more material into that library. Delete removes it from the list.',
  'picker.addDocument': 'Add document',
  'picker.remove': 'Delete',
  'picker.close': 'Close the knowledge library',
  'picker.emptyCreate': '+ New knowledge library',
  'picker.create': 'Untitled knowledge library',
  'picker.uploadTitle': 'Upload a local document',
  'picker.uploadLead': 'Choose a document for this knowledge library. .md, .txt, .html, .pdf, .docx, .csv, .json, and .xlsx are accepted. Spreadsheets fit ask-data better.',
  'picker.chooseFile': 'Choose a local document',
  'picker.selectFile': 'Select a file from library',
  'picker.docsTitle': 'Documents in this library',
  'picker.docsLead': 'Check the documents to hang, or hang the whole library. The choice shows in the conversation bar.',
  'picker.docsEmpty': 'This library has no documents yet. Add one first, or hang the whole library.',
  'picker.docsHang': 'Hang selected documents',
  'picker.docsWhole': 'Hang the whole library',
  'picker.back': 'Back',
  'dock.title': 'Ask knowledge',
  'dock.docsOne': 'Selected: {name}',
  'dock.docsMany': 'Selected: {name} and {count} more',
  'dock.change': 'Change',
  'picker.skipEmpty': 'Skip and ask with an empty library',
  batchQueued: 'Queued',
  batchRunning: 'Working',
  batchDone: 'Added',
  'settings.addDocuments': 'Add documents',
  'settings.addedDocuments': 'Added {count} documents. Review processing status below.',
  'settings.section': 'My knowledge libraries',
  'settings.remove': 'Remove from the list',
  'settings.removeFailed': 'Could not remove the library from the list.',
  'error.noKey': 'API Key is not set',
  'error.terms': 'Use 1 to 6 names, not a full sentence.',
  'error.unbound': 'Hang a knowledge library first.',
  'error.unsupportedType': 'This file type cannot be ingested. Use .md, .txt, .html, .pdf, .docx, .csv, .json, or .xlsx.',
  'error.emptyPick': 'The chosen file did not arrive. Choose it again.',
  'error.docsFailed': 'Could not read this library\u2019s documents. Try again later.',
  'ingest.converting': 'Converting the document',
  'ingest.proposing': 'Organizing entries',
  'ingest.applying': 'Writing the knowledge library. This can take a few minutes.',
  'ingest.timeout': 'Organizing this document took longer than the wait. Try again.',
  'ingest.retained': 'Original and full text saved; ready to ask. Approve wiki enrichment in Settings → My libraries.',
  'ingest.deferred': 'Nothing was written this time: the entries need a human confirmation first.',
  'ingest.failed': 'The document was not written into the knowledge library.',
  'docs.estimate': 'Conservative approval ceiling (not predicted usage): {tokens} tokens across {chunks} chunks. Model calls start only after approval.',
  'docs.approvedEstimate': 'Approved conservative ceiling: {tokens} tokens across {chunks} chunks. Actual usage comes from the model provider.',
  'docs.statusCancelled': 'Processing cancelled; existing files are retained.',
  'docs.partialConversion': 'Partial text; the original may contain additional unextracted content',
  'docs.migrationWarning': 'Legacy document import failed; registered documents remain usable. No automatic retry this launch; restart after resolving the problem. Details: {error}',
  'docs.title': 'Document Management',
  'docs.originalSaved': 'Original saved',
  'docs.originalUnavailable': 'Original unavailable',
  'docs.textSearchable': 'Text searchable',
  'docs.searchableWithProgress': 'Text searchable; knowledge extraction {completed}/{total} chunks',
  'docs.partialNeedsOcr': 'Partial text: page {page} needs OCR',
  'docs.openOriginal': 'Open original',
  'docs.viewExtracted': 'View extracted text',
  'docs.viewSources': 'View sources',
  'docs.retryStage': 'Retry failed stage',
  'docs.uncertainWarning': 'The previous model call has an uncertain outcome and may already have used quota. A confirmed retry makes another paid call; it will never retry automatically.',
  'docs.replayUncertain': 'Confirm another model call (uses quota)',
  'docs.resumeExtraction': 'Resume extraction',
  'docs.cancelProcessing': 'Cancel processing',
  'docs.estimateLabel': 'Estimated usage: ~{tokens} tokens',
  'docs.approveBudget': 'Approve budget',
  'docs.budgetApproved': 'Approved',
  'docs.loading': 'Loading documents…',
  'docs.empty': 'No documents in this library yet',
  'docs.statusConverting': 'Converting format',
  'docs.statusChunking': 'Planning chunks',
  'docs.statusEnriching': 'Extracting knowledge',
  'docs.statusAwaitingApproval': 'Waiting for budget approval',
  'docs.statusWikiIncomplete': 'Processing finished; wiki coverage needs review',
  'docs.usage': 'Provider-reported usage: {tokens} tokens.',
  'docs.usagePartial': 'Known usage: {tokens} tokens; some requests did not report usage.',
  'docs.chunksWithoutPages': '{chunks} chunks produced no knowledge page (possibly duplicates); full wiki fact coverage is not established.',
  'docs.retryRequired': 'The saved model reply cannot be used. Retry the failed step and approve the additional request allowance.',
  'docs.statusPaused': 'Extraction paused',
  'docs.statusFailed': 'Processing failed',
  'docs.statusCompleted': 'Extraction completed',
} as const satisfies Record<AskKnowledgeKey, string>

export { en, zh }
