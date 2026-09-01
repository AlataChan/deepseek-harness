/**
 * Frame extracted document text for a session draft.
 * @module @deepseek-ai/dsh-client-ui-conversation/client/session-document
 */

/** Maximum code points kept inside one session-document frame. */
export const SESSION_DOCUMENT_MAX_CHARS = 32_000

/** Extensions read in the browser without the desktop sidecar. */
export const SESSION_DOCUMENT_PLAIN_EXTENSIONS = ['.md', '.txt'] as const

/** Extensions that need sidecar convert-file. */
export const SESSION_DOCUMENT_CONVERT_EXTENSIONS = ['.html', '.htm', '.pdf'] as const

/** Spreadsheets belong on ask-data, not session extract. */
export const SESSION_DOCUMENT_SPREADSHEET_EXTENSIONS = ['.csv', '.xlsx', '.xls'] as const

/** Native picker accept list for session-only documents. */
export const SESSION_DOCUMENT_ACCEPT = '.md,.txt,.html,.htm,.pdf'

/**
 * Lowercase extension of a filename, including the leading dot.
 * @param filename - `File.name` or a basename.
 * @returns the extension, or an empty string when the name has no dot.
 */
export function sessionDocumentExtension(filename: string): string {
  const name = filename.split(/[/\\]/).at(-1) ?? filename
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

/**
 * Whether the browser can read this file as text without the sidecar.
 * @param extension - lowercase suffix including the leading dot.
 */
export function isSessionDocumentPlainExtension(extension: string): boolean {
  return (SESSION_DOCUMENT_PLAIN_EXTENSIONS as readonly string[]).includes(extension)
}

/**
 * Whether convert-file must run before the draft can hold this file.
 * @param extension - lowercase suffix including the leading dot.
 */
export function isSessionDocumentConvertExtension(extension: string): boolean {
  return (SESSION_DOCUMENT_CONVERT_EXTENSIONS as readonly string[]).includes(extension)
}

/**
 * Whether this file should go through ask-data instead of session extract.
 * @param extension - lowercase suffix including the leading dot.
 */
export function isSessionDocumentSpreadsheet(extension: string): boolean {
  return (SESSION_DOCUMENT_SPREADSHEET_EXTENSIONS as readonly string[]).includes(extension)
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function safeFilename(filename: string): string {
  const name = filename.split(/[/\\]/).at(-1) ?? filename
  return name === '' ? 'document' : name
}

/**
 * Wrap extracted body in a session-document frame and clip long text.
 * @param filename - original basename.
 * @param body - extracted markdown or plain text.
 * @returns framed draft text and whether the body was clipped.
 */
export function frameSessionDocument(
  filename: string,
  body: string,
): { text: string; truncated: boolean } {
  const chars = [...body]
  const truncated = chars.length > SESSION_DOCUMENT_MAX_CHARS
  const clipped = truncated ? chars.slice(0, SESSION_DOCUMENT_MAX_CHARS).join('') : body
  const suffix = truncated ? '\n\n…（仅本会话，正文已截断）' : ''
  return {
    text: `<session-document filename="${escapeAttr(safeFilename(filename))}">\n${clipped}${suffix}\n</session-document>`,
    truncated,
  }
}

/**
 * Append a framed document to the current draft.
 * @param draft - current composer text.
 * @param framed - output of {@link frameSessionDocument}.
 * @returns the next draft.
 */
export function appendSessionDocument(draft: string, framed: string): string {
  if (draft.trim() === '') return framed
  return `${draft.replace(/\s+$/, '')}\n\n${framed}`
}
