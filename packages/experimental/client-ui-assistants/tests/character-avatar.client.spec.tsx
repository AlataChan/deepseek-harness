// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { AvatarPicker, EntityAvatar } from '../src/client/EntityAvatar.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(zh)

it('defaults unset avatars to the seaside whale without replacing explicitly saved initials', () => {
  const view = render(<EntityAvatar name="社区助理" />)
  expect(view.container.querySelector('[data-character="sea-whale"]')).not.toBeNull()
  expect(view.container.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/webp;base64,/)
  expect(view.container.querySelector('svg, image, use')).toBeNull()
  view.rerender(<EntityAvatar name="社区助理" avatar="" />)
  expect(view.container.textContent).toBe('社区')
  view.rerender(<EntityAvatar name="👩‍💻" avatar="initials" />)
  expect(view.container.textContent).toBe('👩‍💻')
  view.rerender(<EntityAvatar name="Jane Smith" avatar="https://example.invalid/avatar.png" />)
  expect(view.container.textContent).toBe('JS')
})

it('offers only the two approved character series and preserves the selection across name changes', () => {
  const change = vi.fn()
  const view = render(<AvatarPicker name="Jane" value="character:auto" onChange={change} t={t} />)
  const seaside = screen.getByRole('group', { name: '海边小伙伴' })
  const robots = screen.getByRole('group', { name: '软萌机器人' })
  expect(within(seaside).getAllByRole('radio')).toHaveLength(3)
  expect(within(robots).getAllByRole('radio')).toHaveLength(2)
  expect((screen.getByRole('radio', { name: zh.avatarWhale }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(within(robots).getByRole('radio', { name: zh.avatarBotCoral }))
  expect(change).toHaveBeenCalledWith('character:bot-coral')
  view.rerender(<AvatarPicker name="New name" value="character:bot-wink" onChange={change} t={t} />)
  expect((screen.getByRole('radio', { name: zh.avatarBotCoral }) as HTMLInputElement).checked).toBe(true)
  expect(view.container.querySelector('[data-character="bot-coral"]')).not.toBeNull()
  expect(view.container.textContent).not.toContain('小精灵')
})

it('retains a saved legacy icon as a selected option until another avatar is chosen', () => {
  render(<AvatarPicker name="Jane" value="icon:document" onChange={vi.fn()} t={t} />)
  expect((screen.getByRole('radio', { name: '已保存的图标' }) as HTMLInputElement).checked).toBe(true)
  expect(document.querySelector('[data-avatar="icon:document"] svg')).not.toBeNull()
  expect(screen.getAllByRole('radio')).toHaveLength(7)
})

it('disables all character choices and keeps separate pickers in independent radio groups', () => {
  render(
    <>
      <AvatarPicker name="A" value="character:auto" onChange={vi.fn()} t={t} disabled />
      <AvatarPicker name="B" value="character:bot-wink" onChange={vi.fn()} t={t} />
    </>,
  )
  const groups = screen.getAllByRole('group', { name: '头像' })
  const [firstGroup, secondGroup] = groups
  if (!firstGroup || !secondGroup) throw new Error('Expected two avatar pickers')
  const first = within(firstGroup).getAllByRole('radio') as HTMLInputElement[]
  const second = within(secondGroup).getAllByRole('radio') as HTMLInputElement[]
  expect(first.every(input => input.matches(':disabled'))).toBe(true)
  expect(second.every(input => !input.matches(':disabled'))).toBe(true)
  expect(first[0]?.name).not.toBe(second[0]?.name)
})

it.each([
  ['sea-jelly', 'sea-seal', zh.avatarSeal],
  ['sea-crab', 'sea-seal-apricot', zh.avatarSealApricot],
  ['bot-bunny', 'bot-sprout', zh.avatarBotSprout],
  ['bot-wink', 'bot-coral', zh.avatarBotCoral],
  ['bot-reader', 'bot-coral', zh.avatarBotCoral],
])('renders saved %s selections with the replacement portrait and a selected picker option', (previous, current, label) => {
  const view = render(<AvatarPicker name="Existing assistant" value={`character:${previous}`} onChange={vi.fn()} t={t} />)
  expect((screen.getByRole('radio', { name: label }) as HTMLInputElement).checked).toBe(true)
  expect(view.container.querySelector(`[data-character="${current}"]`)?.getAttribute('src')).toMatch(/^data:image\/webp;base64,/)
})

it('embeds five distinct approved portraits and no external image URL', () => {
  const view = render(<AvatarPicker name="Assistant" value="character:auto" onChange={vi.fn()} t={t} />)
  const images = Array.from(view.container.querySelectorAll('img'))
  expect(images).toHaveLength(5)
  expect(new Set(images.map(image => image.src)).size).toBe(5)
  expect(images.every(image => image.src.startsWith('data:image/webp;base64,') && image.alt === '')).toBe(true)
})
