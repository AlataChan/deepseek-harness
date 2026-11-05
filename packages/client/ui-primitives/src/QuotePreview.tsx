/** Compact selected-text preview shared by the composer and sent messages. */
import { IconCloseOutlineRegular } from './icons/index.tsx'
import { HoverCard } from './HoverCard.tsx'
import css from './QuotePreview.module.css'

/** Optional whole-quote removal owned by the composer. */
export interface QuotePreviewRemoval {
  /** Localized accessible removal label. */
  readonly label: string
  /** Remove the complete occurrence. */
  readonly onRemove: () => void
}
/** @param props - Literal quote text and optional localized removal. @returns Compact quote and full-text hover preview. */
export function QuotePreview({ text, removal }: {
  readonly text: string
  readonly removal?: QuotePreviewRemoval
}) {
  return <HoverCard inline variant="preview" anchor={<span className={css.quote} data-quote-preview="">
    {removal !== undefined && <button type="button" className={css.remove} aria-label={removal.label}
      onPointerDown={(event) => { event.preventDefault(); event.stopPropagation() }}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); removal.onRemove() }}>
      <IconCloseOutlineRegular size={12} />
    </button>}
    <span className={css.source} data-quote-preview-text="">{text}</span>
  </span>} content={<span className={css.popoverText}>{text}</span>} />
}
