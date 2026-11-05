/** Semantic draft snapshots shared by storage, programmatic input, and editor restoration. */
import { z } from 'zod'
import { formatQuoteText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DraftInput, DraftQuote, DraftReference, DraftSnapshot, Occurrence } from './contract/draft-editor.ts'

const referenceSchema = z.object({
  source: z.string(),
  ref: z.string(),
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive(),
  label: z.string(),
  appearance: z.enum(['session', 'file', 'folder']).optional(),
  clipboardText: z.string(),
  invalid: z.boolean().optional(),
})

const snapshotSchema = z.object({
  text: z.string(),
  references: z.array(referenceSchema),
  quotes: z.array(z.object({ offset: z.number().int().nonnegative(), length: z.number().int().positive(), text: z.string() })).optional(),
}).refine((draft) => {
  for (const values of [draft.references, draft.quotes ?? []]) {
    if (values.some((value, index) => index > 0 && value.offset < (values[index - 1]?.offset ?? 0))) return false
  }
  const spans = [...draft.references, ...(draft.quotes ?? []).map(quote => ({
    ...quote, clipboardText: formatQuoteText(quote.text),
  }))].sort((a, b) => a.offset - b.offset)
  let end = 0
  for (const reference of spans) {
    if (reference.offset < end || reference.length !== reference.clipboardText.length) return false
    end = reference.offset + reference.length
    if (end > draft.text.length || draft.text.slice(reference.offset, end) !== reference.clipboardText) return false
  }
  return true
}, 'Draft references must identify ordered, non-overlapping text spans')

/**
 * Copy input into the semantic draft representation without editor runtime identities.
 * @param input - plain text or caller-owned structured content.
 * @returns an owned snapshot ready for editor import.
 */
export function resolveDraftInput(input: DraftInput): DraftSnapshot {
  if (typeof input === 'string') return { text: input, references: [] }
  return { text: input.text, references: input.references.map(copyReference), ...copyQuotes(input.quotes) }
}

/**
 * Decode persisted drafts, accepting the earlier plain-string representation.
 * @param value - JSON value read from browser storage.
 * @returns the decoded draft, or undefined for invalid data.
 */
export function parseStoredDraft(value: unknown): DraftSnapshot | undefined {
  if (typeof value === 'string') return resolveDraftInput(value)
  const parsed = snapshotSchema.safeParse(value)
  if (!parsed.success) return undefined
  return {
    text: parsed.data.text,
    ...copyQuotes(parsed.data.quotes),
    references: parsed.data.references.map(({ appearance, invalid, ...reference }) => ({
      ...reference,
      ...(appearance === undefined ? {} : { appearance }),
      ...(invalid === undefined ? {} : { invalid }),
    })),
  }
}

/**
 * Export reference identities without their editor-local occurrence ids.
 * @param text - current clipboard projection.
 * @param occurrences - matching reference projections from the same document revision.
 * @param quotes - literal quote projections from the same document revision.
 * @returns an editor-independent snapshot.
 */
export function snapshotDraft(text: string, occurrences: readonly Occurrence[], quotes?: readonly DraftQuote[]): DraftSnapshot {
  return {
    text,
    references: occurrences.map(copyReference),
    ...copyQuotes(quotes),
  }
}

function copyReference(reference: DraftReference): DraftReference {
  return {
    source: reference.source,
    ref: reference.ref,
    offset: reference.offset,
    length: reference.length,
    label: reference.label,
    clipboardText: reference.clipboardText,
    ...(reference.appearance === undefined ? {} : { appearance: reference.appearance }),
    ...(reference.invalid === undefined ? {} : { invalid: reference.invalid }),
  }
}

function copyQuotes(quotes: readonly DraftQuote[] | undefined): Pick<DraftSnapshot, 'quotes'> {
  return quotes === undefined || quotes.length === 0 ? {} : { quotes: quotes.map(quote => ({ ...quote })) }
}
