/** Deterministic terminal Markdown subset. @module @deepseek-ai/dsh-tui/transcript/markdown */

import { displayText, type DisplayText, type DisplayTextBudget } from './display-text.ts'

/** Inline terminal Markdown presentation. */
export type MarkdownInline =
  | { readonly kind: 'text'; readonly text: DisplayText }
  | { readonly kind: 'code'; readonly text: DisplayText }
  | { readonly kind: 'link'; readonly label: DisplayText; readonly url: DisplayText }

/** Block terminal Markdown presentation. */
export type MarkdownBlock =
  | { readonly kind: 'heading'; readonly level: number; readonly content: readonly MarkdownInline[] }
  | { readonly kind: 'paragraph'; readonly content: readonly MarkdownInline[] }
  | { readonly kind: 'list'; readonly items: readonly (readonly MarkdownInline[])[] }
  | { readonly kind: 'code'; readonly language: DisplayText | undefined; readonly text: DisplayText }

const inlinePattern = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/gu

function inline(value: string, budget: DisplayTextBudget): MarkdownInline[] {
  const result: MarkdownInline[] = []
  let cursor = 0
  for (const match of value.matchAll(inlinePattern)) {
    const index = match.index
    if (index > cursor) {
      result.push({ kind: 'text', text: displayText(value.slice(cursor, index), budget) })
    }
    const code = match[1]
    const label = match[2]
    const url = match[3]
    if (code !== undefined) {
      result.push({ kind: 'code', text: displayText(code, budget) })
    } else if (label !== undefined && url !== undefined) {
      result.push({
        kind: 'link',
        label: displayText(label, budget),
        url: displayText(url, budget),
      })
    }
    cursor = index + match[0].length
  }
  if (cursor < value.length || result.length === 0) {
    result.push({ kind: 'text', text: displayText(value.slice(cursor), budget) })
  }
  return result
}

/**
 * Parse the supported Markdown subset into terminal-safe blocks.
 * @param input - untrusted Markdown source.
 * @param budget - limits applied independently to each visible field.
 * @returns headings, paragraphs, lists, and fenced code with safe inline values.
 */
export function parseMarkdown(input: string, budget: DisplayTextBudget): readonly MarkdownBlock[] {
  const lines = input.toWellFormed().split(/\r?\n/u)
  const blocks: MarkdownBlock[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      index += 1
      continue
    }

    const fence = /^```([^`]*)$/u.exec(line)
    if (fence !== null) {
      const code: string[] = []
      index += 1
      while (index < lines.length && lines[index] !== '```') {
        code.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      const language = fence[1]?.trim() ?? ''
      blocks.push({
        kind: 'code',
        language: language === '' ? undefined : displayText(language, budget),
        text: displayText(code.join('\n'), budget),
      })
      continue
    }

    const heading = /^(#{1,6})\s+(.+)$/u.exec(line)
    if (heading !== null) {
      blocks.push({
        kind: 'heading',
        level: heading[1]?.length ?? 1,
        content: inline(heading[2] ?? '', budget),
      })
      index += 1
      continue
    }

    if (/^[-*+]\s+/u.test(line)) {
      const items: MarkdownInline[][] = []
      while (index < lines.length) {
        const item = /^[-*+]\s+(.+)$/u.exec(lines[index] ?? '')
        if (item === null) break
        items.push(inline(item[1] ?? '', budget))
        index += 1
      }
      blocks.push({ kind: 'list', items })
      continue
    }

    const paragraph = [line]
    index += 1
    while (index < lines.length) {
      const next = lines[index] ?? ''
      if (next.trim() === '' || /^```/u.test(next) || /^(#{1,6})\s+/u.test(next) || /^[-*+]\s+/u.test(next)) break
      paragraph.push(next)
      index += 1
    }
    blocks.push({ kind: 'paragraph', content: inline(paragraph.join(' '), budget) })
  }
  return blocks
}
