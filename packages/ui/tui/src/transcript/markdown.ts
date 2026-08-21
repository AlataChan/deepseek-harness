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

function required(value: string | undefined, subject: string): string {
  /* v8 ignore next -- the matching regular expression or index guard requires this value. */
  if (value === undefined) throw new Error(`tui markdown parser lost ${subject}`)
  return value
}

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
    } else {
      result.push({
        kind: 'link',
        label: displayText(required(label, 'link label'), budget),
        url: displayText(required(url, 'link URL'), budget),
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
    const line = required(lines[index], 'current line')
    if (line.trim() === '') {
      index += 1
      continue
    }

    const fence = /^```([^`]*)$/u.exec(line)
    if (fence !== null) {
      const code: string[] = []
      index += 1
      while (index < lines.length && lines[index] !== '```') {
        code.push(required(lines[index], 'fenced code line'))
        index += 1
      }
      if (index < lines.length) index += 1
      const language = required(fence[1], 'fence language').trim()
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
        level: required(heading[1], 'heading marker').length,
        content: inline(required(heading[2], 'heading content'), budget),
      })
      index += 1
      continue
    }

    if (/^[-*+]\s+/u.test(line)) {
      const items: MarkdownInline[][] = []
      while (index < lines.length) {
        const item = /^[-*+]\s+(.+)$/u.exec(required(lines[index], 'list item line'))
        if (item === null) break
        items.push(inline(required(item[1], 'list item content'), budget))
        index += 1
      }
      blocks.push({ kind: 'list', items })
      continue
    }

    const paragraph = [line]
    index += 1
    while (index < lines.length) {
      const next = required(lines[index], 'paragraph line')
      if (next.trim() === '' || /^```/u.test(next) || /^(#{1,6})\s+/u.test(next) || /^[-*+]\s+/u.test(next)) break
      paragraph.push(next)
      index += 1
    }
    blocks.push({ kind: 'paragraph', content: inline(paragraph.join(' '), budget) })
  }
  return blocks
}
