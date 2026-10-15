/** Local avatars shared by assistant and standing-team surfaces. */
import {
  IconUserOutlineRegular,
  IconUsersOutlineRegular,
  IconDeliverDocRegular,
  IconThinkOutlineRegular,
  IconSparkleRegular,
  IconGlobeOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useId } from 'react'
import type { AssistantLocaleKey } from './locales.ts'
import css from './EntityAvatar.module.css'

const presets = [
  { id: 'person', localeKey: 'avatarPerson', Icon: IconUserOutlineRegular },
  { id: 'team', localeKey: 'avatarTeam', Icon: IconUsersOutlineRegular },
  { id: 'document', localeKey: 'avatarDocument', Icon: IconDeliverDocRegular },
  { id: 'idea', localeKey: 'avatarIdea', Icon: IconThinkOutlineRegular },
  { id: 'sparkles', localeKey: 'avatarSparkles', Icon: IconSparkleRegular },
  { id: 'globe', localeKey: 'avatarGlobe', Icon: IconGlobeOutlineRegular },
] as const

/** Avatar display fields; absent or unrecognized selections use initials. */
export interface EntityAvatarProps {
  name: string
  avatar?: string | undefined
  small?: boolean | undefined
}

/**
 * Render deterministic initials or a bundled icon without external requests.
 * @param props - Name and persisted preset selection.
 * @returns Decorative avatar; the adjacent entity name supplies its accessible label.
 */
export function EntityAvatar({ name, avatar, small }: EntityAvatarProps) {
  const words = name.trim().split(/\s+/u).filter(Boolean)
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const glyphs = (text: string) => Array.from(segmenter.segment(text), part => part.segment)
  const initials = (
    words.length > 1 ? `${glyphs(words[0] ?? '')[0] ?? ''}${glyphs(words.at(-1) ?? '')[0] ?? ''}` : glyphs(name.trim()).slice(0, 2).join('')
  ).toLocaleUpperCase()
  let hash = 0
  for (const char of name.normalize('NFC')) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  const preset = presets.find(item => avatar === `icon:${item.id}`)
  const Icon = preset?.Icon
  return (
    <span
      aria-hidden="true"
      className={`${css.avatar} ${css[`color${hash % 6}`]} ${small ? css.small : ''}`}
      data-avatar={preset ? `icon:${preset.id}` : 'initials'}
    >
      {Icon ? <Icon /> : initials || <IconUserOutlineRegular />}
    </span>
  )
}

/** Avatar selector fields shared by creation and editing forms. */
export interface AvatarPickerProps extends EntityAvatarProps {
  t: (key: AssistantLocaleKey) => string
  value: string
  onChange: (value: string) => void
  disabled?: boolean | undefined
}

/**
 * Select automatic initials or a persisted preset icon.
 * @param props - Current selection, preview name, locale and change callback.
 * @returns Accessible radio controls that do not submit their enclosing form.
 */
export function AvatarPicker({ name, value, onChange, disabled, t }: AvatarPickerProps) {
  const groupId = useId()
  return (
    <fieldset className={css.picker} disabled={disabled}>
      <legend>{t('avatar')}</legend>
      <div className={css.options}>
        <label className={css.choice}>
          <input
            type="radio"
            name={groupId}
            checked={!presets.some(item => value === `icon:${item.id}`)}
            onChange={() => {
              onChange('')
            }}
          />
          <EntityAvatar name={name} />
          <span>{t('avatarInitials')}</span>
        </label>
        {presets.map(({ id, localeKey }) => (
          <label key={id} className={css.choice}>
            <input
              type="radio"
              name={groupId}
              checked={value === `icon:${id}`}
              onChange={() => {
                onChange(`icon:${id}`)
              }}
            />
            <EntityAvatar name={name} avatar={`icon:${id}`} />
            <span>{t(localeKey)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
