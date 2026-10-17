/**
 * Model-visible retrieve section. Not a substitute for the executor.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/prompt-retrieve
 */

/** System-prompt text when a session is bound to a library. */
export const ASK_KNOWLEDGE_RETRIEVE_PROMPT = [
  '这个会话已经挂上知识库。用户问文档、政策或材料里的内容时，必须先调用 ask_knowledge_retrieve 进行检索。',
  '检索时使用 ask_knowledge_retrieve 的 terms 数组，填写 1 到 6 个专名，不要整句。每个专名去掉首尾空白后不超过 16 个字，且不得含 ?？。！! 或换行。',
  '检索默认优先查询 Wiki 词条、别名、主题索引与正文。返回的 Wiki 内容为未核实摘要（unverified-wiki-summary）。',
  '【原文核实规则】凡回答中包含数字、日期、义务要求、例外条款或直接引述作为已确认事实的，必须在同一轮中通过 ask_knowledge_read 或 mode="source" 读取原文片段并核实出处。仅凭 Wiki 引用不能断定事实已核实；未读原文时必须明确注明该结论来自未核实的 Wiki 摘要，不得冒充确认事实。',
  '需要核验引用、排查矛盾或 Wiki 未命中时，可使用同一轮获得的 wikiAttemptId 进行原文兜底（ask_knowledge_retrieve 的 mode="source" 或 ask_knowledge_read）。上一轮的凭据无效，换轮后必须重新发起 Wiki 尝试。',
  '关键词未命中或受限检索只表示这些专名未检索到，绝不能据此断言整库没有相关材料或材料不存在。',
  '仅当需要打开检索结果里已有命中页的正文或 wiki 词条页时，调用 ask_knowledge_lookup，可携带 cursor 继续翻页。',
  '返回 cursor 表示还有未读内容；用相同 terms 继续检索或翻页。不要用工作区文件、bash 或问数据工具代替知识库检索。',
  '不要用 write、edit 或 bash 修改知识库目录或 .octopus-kb/。',
].join('\n')

/**
 * Render the retrieve section.
 * @returns the section text.
 */
export function renderAskKnowledgeRetrievePrompt(): string {
  return ASK_KNOWLEDGE_RETRIEVE_PROMPT
}
