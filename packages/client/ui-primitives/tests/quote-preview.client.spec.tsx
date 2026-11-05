// @vitest-environment jsdom
/** Whole-quote removal preserves editor focus and literal excerpt text. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { QuotePreview } from '../src/QuotePreview.tsx'

afterEach(cleanup)

it('removes the complete quote without bubbling a transcript or editor action', () => {
  const remove = vi.fn()
  const parentClick = vi.fn()
  const parentPointer = vi.fn()
  const text = '@literal\n/skill <script>字</script>'
  const view = render(<div onClick={parentClick} onPointerDown={parentPointer}>
    <QuotePreview text={text} removal={{ label: '移除引用', onRemove: remove }} />
  </div>)
  expect(view.container.querySelector('[data-quote-preview-text]')?.textContent).toBe(text)
  expect(view.container.querySelector('script')).toBeNull()
  const button = view.getByRole('button', { name: '移除引用' })
  expect(fireEvent.pointerDown(button)).toBe(false)
  expect(remove).not.toHaveBeenCalled()
  expect(fireEvent.click(button)).toBe(false)
  expect(remove).toHaveBeenCalledOnce()
  expect(parentClick).not.toHaveBeenCalled()
  expect(parentPointer).not.toHaveBeenCalled()
})
