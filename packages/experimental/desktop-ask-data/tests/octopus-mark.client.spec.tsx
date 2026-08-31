/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { OctopusBrandName } from '../src/client/OctopusBrandName.tsx'
import { OctopusHeroHeadline } from '../src/client/OctopusHeroHeadline.tsx'
import { OctopusMark } from '../src/client/OctopusMark.tsx'
import { WorkspaceFolderRow } from '../src/client/WorkspaceFolderRow.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { OCTOPUS_MARK_URI } from '../src/client/octopus-mark-uri.ts'
import { zh } from '../src/client/locales.ts'

const t: TranslateNS<'desktop-ask-data'> = key => (
  key in zh ? zh[key as keyof typeof zh] : key
)

describe('OctopusMark', () => {
  it('paints the leaf-whale plate at the requested size', () => {
    const view = render(<OctopusMark size={24} className="mark" />)
    const img = view.container.querySelector('img')
    expect(img?.getAttribute('src')).toBe(OCTOPUS_MARK_URI)
    expect(img?.getAttribute('width')).toBe('24')
    expect(img?.getAttribute('height')).toBe('24')
    expect(img?.className).toBe('mark')
    expect(img?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('OctopusBrandName', () => {
  it('prints the product name', () => {
    expect(render(<OctopusBrandName />).getByText('octopus_DSH')).toBeTruthy()
  })
})

describe('OctopusHeroHeadline', () => {
  it('prints the overlay headline', () => {
    expect(render(<OctopusHeroHeadline className="h" t={t} />).getByText('先选工作文件夹，再提问')).toBeTruthy()
  })
})

describe('WorkspaceFolderRow', () => {
  it('clicks the hidden desktop settings control', () => {
    const opener = document.createElement('button')
    opener.dataset.testid = 'desktop-settings-open'
    const click = vi.fn()
    opener.addEventListener('click', click)
    document.body.append(opener)
    const view = render(<WorkspaceFolderRow t={t} />)
    fireEvent.click(view.getByText('更改'))
    expect(click).toHaveBeenCalled()
    opener.remove()
  })
})
