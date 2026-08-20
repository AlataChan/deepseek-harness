/** Deterministic prompt serialization for immutable VS Code editor snapshots. */

import type { EditorContextSnapshot } from '@deepseek-ai/dsh-client-connection-vscode/protocol'

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeContent(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * Serialize one captured editor snapshot into bounded prompt text.
 * @param snapshot - immutable capture retained by the context source.
 * @returns deterministic XML-like text with escaped metadata and content.
 */
export function serializeEditorContext(snapshot: EditorContextSnapshot): string {
  const attributes: [string, string][] = [
    ['kind', snapshot.kind],
    ['uri', snapshot.uri],
  ]
  if (snapshot.workspacePath !== undefined) attributes.push(['path', snapshot.workspacePath])
  if (snapshot.languageId !== undefined) attributes.push(['language', snapshot.languageId])
  if (snapshot.version !== undefined) attributes.push(['version', String(snapshot.version)])
  if (snapshot.range !== undefined) {
    const { startLine, startColumn, endLine, endColumn } = snapshot.range
    attributes.push(['range', `${String(startLine + 1)}:${String(startColumn + 1)}-${String(endLine + 1)}:${String(endColumn + 1)}`])
  }
  const opening = attributes.map(([key, value]) => `${key}="${escapeAttribute(value)}"`).join(' ')
  return `<ide_context ${opening}>\n${escapeContent(snapshot.text)}\n</ide_context>`
}
