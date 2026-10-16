/**
 * Model-visible retrieve section. Not a substitute for the executor.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/prompt-retrieve
 */

/** System-prompt text when a session is bound to a library. */
export const ASK_KNOWLEDGE_RETRIEVE_PROMPT = [
  '这个会话已经挂上知识库。用户问文档、政策或材料里的内容时，必须先调用 ask_knowledge_retrieve。',
  '检索时使用 ask_knowledge_retrieve 的 terms 数组，填写 1 到 6 个专名，不要整句。',
  '每个专名去掉首尾空白后不超过 16 个字，且不得含 ?？。！! 或换行。',
  'ask_knowledge_retrieve 的返回里已有命中页的正文。先根据这些正文回答。',
  '返回 cursor 表示还有未读内容；用相同 terms 和 documentFilter 继续检索。需要完整段落时，调用 ask_knowledge_read 并继续读取其 cursor。',
  '不要用工作区文件、bash 或问数据工具代替知识库检索。检索无结果也只表示这些专名未命中；有截断警告或 cursor 时不能断言整库没有材料。',
  '仅当需要打开检索结果里某一条 wiki 词条页时，再调用 ask_knowledge_lookup，term 用该页标题或路径。',
  '不要用 write、edit 或 bash 修改知识库目录或 .octopus-kb/。',
].join('\n')

/**
 * Render the retrieve section.
 * @returns the section text.
 */
export function renderAskKnowledgeRetrievePrompt(): string {
  return ASK_KNOWLEDGE_RETRIEVE_PROMPT
}
