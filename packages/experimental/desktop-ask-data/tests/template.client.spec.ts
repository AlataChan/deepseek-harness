/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ASK_DATA_TEMPLATE_CSV,
  ASK_DATA_TEMPLATE_FILENAME,
  copyAskDataTemplateText,
  offerAskDataTemplate,
  saveAskDataTemplatePicker,
  triggerAskDataTemplateAnchorDownload,
} from '../src/client/template.ts'

function stubExecCommand(impl: () => boolean): void {
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: impl,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ask-data fill-in template', () => {
  it('keeps the sample column names and two example rows', () => {
    expect(ASK_DATA_TEMPLATE_FILENAME).toBe('问数填写模板.csv')
    expect(ASK_DATA_TEMPLATE_CSV.startsWith('\uFEFF')).toBe(true)
    expect(ASK_DATA_TEMPLATE_CSV).toContain('日期,渠道,商品,数量,金额')
    expect(ASK_DATA_TEMPLATE_CSV).toContain('线上')
    expect(ASK_DATA_TEMPLATE_CSV).toContain('门店')
  })

  it('requests an anchor download', () => {
    const createObjectURL = vi.fn(() => 'blob:ask-data-template')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const click = vi.fn()
    const createElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = createElement(tag)
      if (tag === 'a') el.click = click
      return el
    })
    triggerAskDataTemplateAnchorDownload()
    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalled()
  })

  it('skips the save picker when the WebView has none', async () => {
    await expect(saveAskDataTemplatePicker()).resolves.toBe(false)
  })

  it('writes through the save picker', async () => {
    const write = vi.fn(async () => undefined)
    const close = vi.fn(async () => undefined)
    vi.stubGlobal('showSaveFilePicker', async () => ({
      createWritable: async () => ({ write, close }),
    }))
    await expect(saveAskDataTemplatePicker()).resolves.toBe(true)
    expect(write).toHaveBeenCalledWith(ASK_DATA_TEMPLATE_CSV)
    expect(close).toHaveBeenCalled()
  })

  it('treats a cancelled picker as not saved', async () => {
    vi.stubGlobal('showSaveFilePicker', async () => {
      throw new Error('AbortError')
    })
    await expect(saveAskDataTemplatePicker()).resolves.toBe(false)
  })

  it('copies through the clipboard API', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(copyAskDataTemplateText()).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith(ASK_DATA_TEMPLATE_CSV)
  })

  it('falls back to execCommand when clipboard write throws', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: async () => { throw new Error('denied') } },
    })
    stubExecCommand(() => true)
    await expect(copyAskDataTemplateText()).resolves.toBe(true)
  })

  it('falls back to execCommand when clipboard is missing', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined })
    stubExecCommand(() => true)
    await expect(copyAskDataTemplateText()).resolves.toBe(true)
  })

  it('reports a failed execCommand copy', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined })
    stubExecCommand(() => false)
    await expect(copyAskDataTemplateText()).resolves.toBe(false)
  })

  it('reports a missing execCommand as a failed copy', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined })
    stubExecCommand(() => {
      throw new Error('not supported')
    })
    await expect(copyAskDataTemplateText()).resolves.toBe(false)
  })

  it('prefers the save picker when offering the template', async () => {
    vi.stubGlobal('showSaveFilePicker', async () => ({
      createWritable: async () => ({
        write: async () => undefined,
        close: async () => undefined,
      }),
    }))
    await expect(offerAskDataTemplate()).resolves.toBe('saved')
  })

  it('copies after a skipped picker', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:ask-data-template',
      revokeObjectURL: () => undefined,
    })
    await expect(offerAskDataTemplate()).resolves.toBe('copied')
  })

  it('shows the template when nothing can copy', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined })
    stubExecCommand(() => false)
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:ask-data-template',
      revokeObjectURL: () => undefined,
    })
    await expect(offerAskDataTemplate()).resolves.toBe('shown')
  })
})
