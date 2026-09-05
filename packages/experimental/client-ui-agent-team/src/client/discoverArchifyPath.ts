/** Discover `ARCHIFY_HTML_PATH` from the loaded Chat conversation snapshot. */

/** Extract `ARCHIFY_HTML_PATH: …` from free text (assistant reply or paste). */
export function extractArchifyPath(text: string): string | null {
  const match = /ARCHIFY_HTML_PATH:\s*(\S+)/u.exec(text)
  if (match?.[1] === undefined) return null
  return match[1].replace(/^['"]|['"]$/gu, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function textFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const block of blocks) {
    if (!isRecord(block)) continue
    if (block.kind === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('')
}

function pathFromText(text: string): string | null {
  if (text === '') return null
  const path = extractArchifyPath(text)
  if (path === null) return null
  // Avoid autofill on a mid-stream truncated token sequence.
  if (!/\.html?$/iu.test(path)) return null
  return path
}

function pathFromNodeData(data: unknown): string | null {
  if (!isRecord(data)) return null
  const direct = pathFromText(textFromBlocks(data.blocks))
  if (direct !== null) return direct
  const closing = data.closing
  if (isRecord(closing)) {
    const fromClosing = pathFromText(textFromBlocks(closing.blocks))
    if (fromClosing !== null) return fromClosing
  }
  return null
}

/**
 * Scan a Chat view snapshot (duck-typed) newest-first for a complete Archify HTML path.
 * @param chat - `conversation.views.get('chat')` value, or undefined when Chat is absent.
 * @returns absolute or workspace-relative `.html` / `.htm` path, or null.
 */
export function discoverArchifyPath(chat: unknown): string | null {
  if (!isRecord(chat)) return null
  const nodes = chat.nodes
  if (isRecord(nodes) && typeof nodes.get === 'function' && Array.isArray(chat.order)) {
    const order = chat.order as readonly string[]
    for (let i = order.length - 1; i >= 0; i--) {
      const key = order[i]
      if (key === undefined) continue
      const node = nodes.get(key)
      if (!isRecord(node)) continue
      if (node.kind !== 'assistant' && node.kind !== 'turn-tail') continue
      const found = pathFromNodeData(node.data)
      if (found !== null) return found
    }
  }
  if (isRecord(nodes) && typeof nodes.values === 'function') {
    const values = nodes.values()
    if (Array.isArray(values)) {
      for (let i = values.length - 1; i >= 0; i--) {
        const node = values[i]
        if (!isRecord(node)) continue
        if (node.kind !== 'assistant' && node.kind !== 'turn-tail') continue
        const found = pathFromNodeData(node.data)
        if (found !== null) return found
      }
    }
  }
  const legacy = chat.legacy
  if (isRecord(legacy) && isRecord(legacy.partial)) {
    const fromPartial = pathFromText(textFromBlocks(legacy.partial.blocks))
    if (fromPartial !== null) return fromPartial
  }
  return null
}

/**
 * Read the Chat target from a Conversation views store without depending on ui-chat types.
 * @param views - `conversation.views` from the Session Conversation snapshot.
 * @returns discovered path or null.
 */
export function discoverArchifyPathFromViews(views: { get(target: string): unknown }): string | null {
  return discoverArchifyPath(views.get('chat'))
}
