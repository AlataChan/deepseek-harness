/**
 * User-visible Chinese and English copy for the ask-knowledge overlay.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/client/locales
 */

/** Overlay dictionary keys. */
export type AskKnowledgeKey =
  | 'chip.unbound'
  | 'picker.title'
  | 'picker.leadAskData'
  | 'picker.leadLibrary'
  | 'picker.leadPreset'
  | 'picker.leadDataMode'
  | 'picker.leadThicken'
  | 'picker.addDocument'
  | 'picker.remove'
  | 'picker.emptyCreate'
  | 'picker.create'
  | 'picker.uploadTitle'
  | 'picker.uploadLead'
  | 'picker.chooseFile'
  | 'picker.skipEmpty'
  | 'settings.section'
  | 'settings.remove'
  | 'settings.removeFailed'
  | 'error.noKey'
  | 'error.terms'
  | 'error.unbound'
  | 'error.unsupportedType'
  | 'ingest.converting'
  | 'ingest.proposing'
  | 'ingest.applying'
  | 'ingest.timeout'
  | 'ingest.deferred'
  | 'ingest.failed'

/** Chinese copy for the ask-knowledge chip, picker, settings, and ingest. */
const zh = {
  'chip.unbound': '知识库',
  'picker.title': '选一个知识库',
  'picker.leadAskData': '问数是这一次问一张表，问完锁在这个会话。',
  'picker.leadLibrary': '知识库是问一套会变厚的材料，换会话还能用。',
  'picker.leadPreset': '挂上库不是换成另一种助理，默认仍是标准模式，只是多了检索工具。',
  'picker.leadDataMode': '当前是数据模式时，点库名会新开一个标准会话再挂上。数据模式只问表，不会按知识库问答。',
  'picker.leadThicken': '点库名挂到这个会话。点添加文档，往这个库再放一份材料。点删除，从名单去掉。',
  'picker.addDocument': '添加文档',
  'picker.remove': '删除',
  'picker.emptyCreate': '+ 新建知识库',
  'picker.create': '未命名知识库',
  'picker.uploadTitle': '上传本地文档',
  'picker.uploadLead': '选一份文档写进这个知识库。可以用 .md、.txt、.html、.pdf、.csv、.json、.xlsx。表格更适合走问数。',
  'picker.chooseFile': '选择本地文档',
  'picker.skipEmpty': '先空着，直接提问',
  'settings.section': '我的知识库',
  'settings.remove': '从名单移除',
  'settings.removeFailed': '没能从名单移除。',
  'error.noKey': '还没有 API Key',
  'error.terms': '请改用 1 到 6 个专名，不要整句。',
  'error.unbound': '先在上方挂上一个知识库。',
  'error.unsupportedType': '这种文件还不能入库。请用 .md、.txt、.html、.pdf、.csv、.json 或 .xlsx。',
  'ingest.converting': '正在转换文档',
  'ingest.proposing': '正在整理成词条',
  'ingest.applying': '正在写入知识库，可能需要几分钟。',
  'ingest.timeout': '整理这份文档超过了等待时间。请再试一次。',
  'ingest.deferred': '有 N 条没入库，这次没有全部写进去。',
  'ingest.failed': '文档没有写进知识库。',
} as const satisfies Record<AskKnowledgeKey, string>

/** English copy for the ask-knowledge chip, picker, settings, and ingest. */
const en = {
  'chip.unbound': 'Knowledge',
  'picker.title': 'Choose a knowledge library',
  'picker.leadAskData': 'Ask-data asks one table in this session and stays locked here.',
  'picker.leadLibrary': 'A knowledge library thickens over time and can be reused in other sessions.',
  'picker.leadPreset': 'Hanging a library does not change the assistant. Standard mode stays; retrieve tools are added.',
  'picker.leadDataMode': 'If this chat is in data mode, clicking a name opens a new standard session and hangs the library there. Data mode only asks tables and will not retrieve from the library.',
  'picker.leadThicken': 'Click a name to hang it. Add a document to put more material into that library. Delete removes it from the list.',
  'picker.addDocument': 'Add document',
  'picker.remove': 'Delete',
  'picker.emptyCreate': '+ New knowledge library',
  'picker.create': 'Untitled knowledge library',
  'picker.uploadTitle': 'Upload a local document',
  'picker.uploadLead': 'Choose a document for this knowledge library. .md, .txt, .html, .pdf, .csv, .json, and .xlsx are accepted. Spreadsheets fit ask-data better.',
  'picker.chooseFile': 'Choose a local document',
  'picker.skipEmpty': 'Skip and ask with an empty library',
  'settings.section': 'My knowledge libraries',
  'settings.remove': 'Remove from the list',
  'settings.removeFailed': 'Could not remove the library from the list.',
  'error.noKey': 'API Key is not set',
  'error.terms': 'Use 1 to 6 names, not a full sentence.',
  'error.unbound': 'Hang a knowledge library first.',
  'error.unsupportedType': 'This file type cannot be ingested. Use .md, .txt, .html, .pdf, .csv, .json, or .xlsx.',
  'ingest.converting': 'Converting the document',
  'ingest.proposing': 'Organizing entries',
  'ingest.applying': 'Writing the knowledge library. This can take a few minutes.',
  'ingest.timeout': 'Organizing this document took longer than the wait. Try again.',
  'ingest.deferred': 'N items were not ingested.',
  'ingest.failed': 'The document was not written into the knowledge library.',
} as const satisfies Record<AskKnowledgeKey, string>

export { en, zh }
