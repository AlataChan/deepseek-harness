/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { WorksButton } from '../src/client/WorksButton.tsx'
import { setWorksOpen, worksOpen } from '../src/client/works-state.ts'
import { zh } from '../src/client/locales.ts'

const t = (key: keyof typeof zh) => zh[key]

afterEach(() => {
  setWorksOpen(false)
  cleanup()
})

describe('WorksButton', () => {
  it('toggles Works and restores focus when the overlay closes', () => {
    const wide = render(<WorksButton wide t={t} {...{} as never} />)
    const button = wide.getByRole('button', { name: '作品' })
    expect(button.textContent).toContain('作品')
    fireEvent.click(button)
    expect(worksOpen()).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(button)
    expect(worksOpen()).toBe(false)
    expect(document.activeElement).toBe(button)
    wide.unmount()

    const rail = render(<WorksButton wide={false} t={t} {...{} as never} />)
    expect(rail.getByRole('button', { name: '作品' }).textContent).not.toContain('作品')
    setWorksOpen(true)
    setWorksOpen(false)
    expect(document.activeElement).toBe(rail.getByRole('button', { name: '作品' }))
  })
})
