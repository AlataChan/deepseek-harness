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
import { CharacterPortrait, type CharacterVariant } from './CharacterPortrait.tsx'
import css from './EntityAvatar.module.css'

/** Unset avatars use the seaside whale; explicit empty strings preserve historical initials. */
export const DEFAULT_AVATAR = 'character:auto'

const seaside = [
  { id: 'sea-whale', localeKey: 'avatarWhale', color: 'color1' },
  { id: 'sea-seal', localeKey: 'avatarSeal', color: 'color3' },
  { id: 'sea-seal-apricot', localeKey: 'avatarSealApricot', color: 'color4' },
] as const satisfies readonly { id: CharacterVariant; localeKey: AssistantLocaleKey; color: string }[]

const robots = [
  { id: 'bot-sprout', localeKey: 'avatarBotSprout', color: 'color1' },
  { id: 'bot-coral', localeKey: 'avatarBotCoral', color: 'color4' },
] as const satisfies readonly { id: CharacterVariant; localeKey: AssistantLocaleKey; color: string }[]

const characters = [...seaside, ...robots]
// Saved selections from the previous collection resolve without rewriting the catalog.
const previousCharacters: Readonly<Record<string, string | undefined>> = {
  'character:sea-jelly': 'character:sea-seal',
  'character:sea-crab': 'character:sea-seal-apricot',
  'character:bot-bunny': 'character:bot-sprout',
  'character:bot-wink': 'character:bot-coral',
  'character:bot-reader': 'character:bot-coral',
}
const legacyPresets = [
  { id: 'person', localeKey: 'avatarPerson', Icon: IconUserOutlineRegular },
  { id: 'team', localeKey: 'avatarTeam', Icon: IconUsersOutlineRegular },
  { id: 'document', localeKey: 'avatarDocument', Icon: IconDeliverDocRegular },
  { id: 'idea', localeKey: 'avatarIdea', Icon: IconThinkOutlineRegular },
  { id: 'sparkles', localeKey: 'avatarSparkles', Icon: IconSparkleRegular },
  { id: 'globe', localeKey: 'avatarGlobe', Icon: IconGlobeOutlineRegular },
] as const

/** Avatar display fields; absent values use the whale, legacy values retain their display. */
export interface EntityAvatarProps {
  name: string
  avatar?: string | undefined
  small?: boolean | undefined
}

/**
 * Render a local character, historical icon, or grapheme-safe initials without external requests.
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
  const resolvedAvatar = avatar === undefined || avatar === DEFAULT_AVATAR ? 'character:sea-whale' : previousCharacters[avatar] ?? avatar
  const character = characters.find(item => resolvedAvatar === `character:${item.id}`)
  const preset = legacyPresets.find(item => avatar === `icon:${item.id}`)
  const Icon = preset?.Icon
  return (
    <span
      aria-hidden="true"
      className={`${css.avatar} ${css[character?.color ?? `color${hash % 6}`]} ${character ? css.character : ''} ${small ? css.small : ''}`}
      data-avatar={character ? `character:${character.id}` : preset ? `icon:${preset.id}` : 'initials'}
    >
      {character ? <CharacterPortrait variant={character.id} /> : Icon ? <Icon /> : initials || <IconUserOutlineRegular />}
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
 * Select a character from either series or initials, retaining a saved legacy icon.
 * @param props - Current selection, preview name, locale and change callback.
 * @returns Accessible radio controls that do not submit their enclosing form.
 */
export function AvatarPicker({ name, value, onChange, disabled, t }: AvatarPickerProps) {
  const groupId = useId()
  const legacy = legacyPresets.find(item => value === `icon:${item.id}`)
  const resolvedValue = value === DEFAULT_AVATAR ? 'character:sea-whale' : previousCharacters[value] ?? value
  const selected = characters.some(item => resolvedValue === `character:${item.id}`) || legacy ? resolvedValue : ''
  const choice = (selection: string, label: AssistantLocaleKey) => (
    <label className={css.choice} key={selection}>
      <input
        type="radio"
        name={groupId}
        checked={selected === selection}
        onChange={() => {
          onChange(selection)
        }}
      />
      <EntityAvatar name={name} avatar={selection} />
      <span>{t(label)}</span>
    </label>
  )
  return (
    <fieldset className={css.picker} disabled={disabled}>
      <legend>{t('avatar')}</legend>
      <div className={css.series} role="group" aria-label={t('avatarSeaside')}>
        <div className={css.seriesTitle}>
          {t('avatarSeaside')}
          <span className={css.badge}>{t('avatarDefault')}</span>
        </div>
        <div className={css.options}>{seaside.map(item => choice(`character:${item.id}`, item.localeKey))}</div>
      </div>
      <div className={css.series} role="group" aria-label={t('avatarRobots')}>
        <div className={css.seriesTitle}>{t('avatarRobots')}</div>
        <div className={css.options}>{robots.map(item => choice(`character:${item.id}`, item.localeKey))}</div>
      </div>
      <div className={css.otherOptions}>
        {choice('', 'avatarInitials')}
        {legacy && choice(`icon:${legacy.id}`, 'avatarSavedIcon')}
      </div>
    </fieldset>
  )
}
