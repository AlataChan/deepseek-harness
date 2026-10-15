/** Approved character portraits embedded in the Client bundle for offline rendering. */
import { CHARACTER_IMAGES } from './character-images.ts'
import css from './CharacterPortrait.module.css'

/** Stable selections for the five approved character portraits. */
export type CharacterVariant = keyof typeof CHARACTER_IMAGES

/**
 * Render an approved portrait without external image requests.
 * @param props - Selected seaside or robot character.
 * @returns Decorative image; the enclosing entity name supplies the accessible text.
 */
export function CharacterPortrait({ variant }: { variant: CharacterVariant }) {
  return <img src={CHARACTER_IMAGES[variant]} alt="" aria-hidden="true" draggable={false} data-character={variant} className={css.portrait} />
}
