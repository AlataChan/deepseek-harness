/**
 * Fill-in CSV that matches the packaged sample columns.
 * Tauri WebView ignores `<a download>`, so the button also copies or shows the text.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-data/client/template
 */

/** Download name shown in the browser save dialog. */
export const ASK_DATA_TEMPLATE_FILENAME = '问数填写模板.csv'

/**
 * UTF-8 BOM plus header and two example rows. Excel on Windows needs the BOM
 * to keep 日期 / 渠道 readable.
 */
export const ASK_DATA_TEMPLATE_CSV = '\uFEFF日期,渠道,商品,数量,金额\n2026-01-02,线上,绿茶,3,120\n2026-01-03,门店,红茶,2,80\n'

/** How {@link offerAskDataTemplate} delivered the CSV. */
export type AskDataTemplateOffer = 'saved' | 'copied' | 'shown'

interface SaveFilePickerHandle {
  createWritable(): Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>
}

/**
 * Request a local file for {@link ASK_DATA_TEMPLATE_CSV}.
 * Tauri WebView typically ignores this; the caller still needs copy or preview.
 */
export function triggerAskDataTemplateAnchorDownload(): void {
  const blob = new Blob([ASK_DATA_TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = ASK_DATA_TEMPLATE_FILENAME
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Try the File System Access save picker when the WebView implements it.
 * @returns whether a file was written.
 */
export async function saveAskDataTemplatePicker(): Promise<boolean> {
  const picker = (globalThis as {
    showSaveFilePicker?: (options: { suggestedName: string }) => Promise<SaveFilePickerHandle>
  }).showSaveFilePicker
  if (picker === undefined) return false
  try {
    const handle = await picker({ suggestedName: ASK_DATA_TEMPLATE_FILENAME })
    const writable = await handle.createWritable()
    await writable.write(ASK_DATA_TEMPLATE_CSV)
    await writable.close()
    return true
  } catch {
    // cancelled picker or a WebView that advertised the API but cannot write
    return false
  }
}

/**
 * Copy {@link ASK_DATA_TEMPLATE_CSV} to the clipboard.
 * @returns whether the clipboard now holds the CSV.
 */
export async function copyAskDataTemplateText(): Promise<boolean> {
  try {
    const clipboard = navigator.clipboard
    if (clipboard?.writeText !== undefined) {
      await clipboard.writeText(ASK_DATA_TEMPLATE_CSV)
      return true
    }
  } catch {
    // permission denied or missing user-gesture clipboard
  }
  return copyAskDataTemplateViaExecCommand()
}

/**
 * Offer the fill-in CSV: picker, then `<a download>`, then clipboard, then preview.
 * @returns how the CSV was delivered.
 */
export async function offerAskDataTemplate(): Promise<AskDataTemplateOffer> {
  if (await saveAskDataTemplatePicker()) return 'saved'
  triggerAskDataTemplateAnchorDownload()
  return await copyAskDataTemplateText() ? 'copied' : 'shown'
}

function copyAskDataTemplateViaExecCommand(): boolean {
  const area = document.createElement('textarea')
  area.value = ASK_DATA_TEMPLATE_CSV
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.left = '-9999px'
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    // execCommand is missing or blocked
    return false
  } finally {
    area.remove()
  }
}
