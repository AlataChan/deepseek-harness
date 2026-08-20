// @vitest-environment jsdom
/** Explicit editor-context menu behavior. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ContextButton, type ContextButtonProps } from '../src/client/ContextButton.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: ContextButtonProps['t'] = makeTranslate(zh, commonZh)

function setup(capture = vi.fn(() => Promise.resolve(true)), phase: 'plain' | 'submitting' = 'plain') {
  const props = {
    t,
    capture,
    input: { phase },
    session: { removed: false },
  } as unknown as ContextButtonProps
  return { capture, ...render(<ContextButton {...props} />) }
}

describe('ContextButton', () => {
  it('offers the three explicit capture actions and inserts the selected result once', async () => {
    const { capture } = setup()
    fireEvent.click(screen.getByRole('button', { name: '添加编辑器上下文' }))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      '当前选区', '当前文件', '当前文件的问题',
    ])
    fireEvent.click(screen.getByRole('menuitem', { name: '当前选区' }))
    expect(capture).toHaveBeenCalledWith('selection')
    expect(capture).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows empty and failure feedback without inventing a chip', async () => {
    const capture = vi.fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('selection too large'))
      .mockRejectedValueOnce('transport closed')
    setup(capture)
    fireEvent.click(screen.getByRole('button', { name: '添加编辑器上下文' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '当前文件' }))
    expect((await screen.findByRole('status')).textContent).toBe('没有可添加的编辑器上下文。')
    fireEvent.click(screen.getByRole('button', { name: '添加编辑器上下文' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '当前选区' }))
    expect((await screen.findByRole('status')).getAttribute('title')).toBe('selection too large')
    fireEvent.click(screen.getByRole('button', { name: '添加编辑器上下文' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '当前文件的问题' }))
    expect((await screen.findByRole('status')).getAttribute('title')).toBe('transport closed')
  })

  it('closes the menu on Escape', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '添加编辑器上下文' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('ignores capture settlement after unmount', async () => {
    const fulfilled = Promise.withResolvers<boolean>()
    const rejected = Promise.withResolvers<boolean>()
    const first = setup(vi.fn(() => fulfilled.promise))
    fireEvent.click(screen.getByRole('button', { name: '添加编辑器上下文' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '当前选区' }))
    first.unmount()
    fulfilled.resolve(true)
    await fulfilled.promise

    const second = setup(vi.fn(() => rejected.promise))
    fireEvent.click(screen.getByRole('button', { name: '添加编辑器上下文' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '当前文件' }))
    second.unmount()
    rejected.reject(new Error('disposed'))
    await expect(rejected.promise).rejects.toThrow('disposed')
  })

  it('disables while the input machine is submitting', () => {
    setup(vi.fn(), 'submitting')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '添加编辑器上下文' }).disabled).toBe(true)
  })
})
