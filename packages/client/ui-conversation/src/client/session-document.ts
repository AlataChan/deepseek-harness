/**
 * Frame extracted document text for a session draft.
 * @module @deepseek-ai/dsh-client-ui-conversation/client/session-document
 */

/** Maximum code points kept inside one session-document frame. */
export const SESSION_DOCUMENT_MAX_CHARS = 32_000

/** Extensions read in the browser without the desktop sidecar. */
export const SESSION_DOCUMENT_PLAIN_EXTENSIONS = ['.md', '.txt'] as const

/** Extensions that need the desktop overlay before the draft can hold them. */
export const SESSION_DOCUMENT_CONVERT_EXTENSIONS = ['.html', '.htm', '.pdf', '.docx'] as const

/** Spreadsheets belong on ask-data, not session extract. */
export const SESSION_DOCUMENT_SPREADSHEET_EXTENSIONS = ['.csv', '.xlsx', '.xls'] as const

/**
 * Allowed session-document suffixes for JS checks and product copy.
 * Do not set this as the input `accept` in Tauri WebView: WebKit then closes
 * the dialog without delivering a File when the UTI or MIME does not match.
 */
export const SESSION_DOCUMENT_ACCEPT = '.md,.txt,.html,.htm,.pdf,.docx'

/**
 * Bind change/input on the file element itself.
 * React root delegation misses WKWebView file-input change when it does not bubble.
 * @param el - the mounted file input, or null on unmount.
 * @param onFiles - files after a completed pick; empty when the dialog closed without a File.
 * Clearing the input after a File was already taken does not emit empty.
 * @returns disposer.
 */
export function bindNativeFileChange(
  el: HTMLInputElement | null,
  onFiles: (files: readonly File[]) => void,
): () => void {
  if (el === null) return () => {}
  let cancelled = false
  let ignoreEmpty = false
  let busy = false
  const deliver = (): void => {
    if (cancelled) {
      cancelled = false
      ignoreEmpty = false
      busy = false
      el.value = ''
      return
    }
    if (busy) return
    const list = el.files
    const files = list === null ? [] : [...list]
    if (files.length === 0) {
      if (ignoreEmpty) return
      onFiles([])
      return
    }
    busy = true
    ignoreEmpty = true
    el.value = ''
    onFiles(files)
    queueMicrotask(() => { busy = false })
  }
  const onReady = (): void => { ignoreEmpty = false }
  const onCancel = (): void => { cancelled = true }
  el.addEventListener('click', onReady)
  el.addEventListener('cancel', onCancel)
  el.addEventListener('change', deliver)
  el.addEventListener('input', deliver)
  return () => {
    el.removeEventListener('click', onReady)
    el.removeEventListener('cancel', onCancel)
    el.removeEventListener('change', deliver)
    el.removeEventListener('input', deliver)
  }
}

/**
 * Read a user-selected file as text.
 * `File.text()` is missing or rejects in some WebViews; FileReader still works.
 * @param file - a File from a native picker.
 * @returns the decoded text.
 */
export async function readSessionDocumentText(file: File): Promise<string> {
  try {
    if (typeof file.text === 'function') return await file.text()
  } catch {
    // WKWebView File.text() can reject after a successful picker.
  }
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '')
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('FileReader failed'))
    }
    reader.readAsText(file)
  })
}

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
 * @returns true when the suffix is Markdown or TXT.
 */
export function isSessionDocumentPlainExtension(extension: string): boolean {
  return (SESSION_DOCUMENT_PLAIN_EXTENSIONS as readonly string[]).includes(extension)
}

/**
 * Whether the desktop overlay must extract this file before the draft can hold it.
 * @param extension - lowercase suffix including the leading dot.
 * @returns true when the suffix is HTML, PDF, or Word.
 */
export function isSessionDocumentConvertExtension(extension: string): boolean {
  return (SESSION_DOCUMENT_CONVERT_EXTENSIONS as readonly string[]).includes(extension)
}

/**
 * Whether this file should go through ask-data instead of session extract.
 * @param extension - lowercase suffix including the leading dot.
 * @returns true when the suffix is a spreadsheet.
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
