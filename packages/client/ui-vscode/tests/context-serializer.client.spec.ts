/** Deterministic model serialization for immutable editor snapshots. */

import { describe, expect, it } from 'vitest'
import { EditorContextId, type EditorContextSnapshot } from '@deepseek-ai/dsh-client-connection-vscode/protocol'
import { serializeEditorContext } from '../src/client/context-serializer.ts'

function snapshot(overrides: Partial<EditorContextSnapshot> = {}): EditorContextSnapshot {
  return {
    id: EditorContextId('capture-1'),
    kind: 'selection',
    uri: 'file:///workspace/src/main.ts?x=1&y=2',
    workspacePath: 'src/a&".ts',
    languageId: 'type<script',
    version: 7,
    range: { startLine: 1, startColumn: 2, endLine: 3, endColumn: 5 },
    text: 'const closing = "</ide_context>&"',
    capturedAt: 1_700_000_000_000,
    ...overrides,
  }
}

describe('serializeEditorContext', () => {
  it('preserves metadata and escapes attributes and closing-tag content', () => {
    expect(serializeEditorContext(snapshot())).toBe(
      '<ide_context kind="selection" uri="file:///workspace/src/main.ts?x=1&amp;y=2" path="src/a&amp;&quot;.ts" language="type&lt;script" version="7" range="2:3-4:6">\n'
      + 'const closing = "&lt;/ide_context&gt;&amp;"\n'
      + '</ide_context>',
    )
  })

  it('omits unavailable optional metadata without changing attribute order', () => {
    expect(serializeEditorContext({
      id: EditorContextId('capture-1'),
      kind: 'file',
      uri: 'file:///workspace/src/main.ts?x=1&y=2',
      text: 'const closing = "</ide_context>&"',
      capturedAt: 1_700_000_000_000,
    })).toBe(
      '<ide_context kind="file" uri="file:///workspace/src/main.ts?x=1&amp;y=2">\n'
      + 'const closing = "&lt;/ide_context&gt;&amp;"\n'
      + '</ide_context>',
    )
  })
})
