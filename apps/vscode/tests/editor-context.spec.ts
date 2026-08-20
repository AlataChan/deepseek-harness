/** Extension-host capture of explicit immutable editor snapshots. */

import { describe, expect, it, vi } from 'vitest'
import { EditorContextCapture, type EditorContextPorts } from '../src/editor-context.ts'

function uri(path: string) {
  return { fsPath: path, scheme: 'file', toString: () => `file://${path}` }
}

function range(startLine: number, startColumn: number, endLine: number, endColumn: number) {
  return {
    start: { line: startLine, character: startColumn },
    end: { line: endLine, character: endColumn },
  }
}

function bench(text = 'const value = 1\n') {
  let documentText = text
  const document = {
    uri: uri('/workspace/src/main.ts'),
    languageId: 'typescript',
    version: 7,
    getText: vi.fn((selection?: ReturnType<typeof range>) => selection === undefined ? documentText : 'value'),
  }
  const editor = { document, selection: range(0, 6, 0, 11) }
  let id = 0
  const ports: EditorContextPorts = {
    activeEditor: () => editor,
    diagnostics: () => [],
    randomId: () => `capture-${String(++id)}`,
    now: () => 1_700_000_000_000,
  }
  const capture = new EditorContextCapture(ports, {
    maxSelectionBytes: 32,
    maxFileBytes: 128,
    maxDiagnostics: 2,
  })
  return { capture, document, editor, ports, setText: (next: string) => { documentText = next } }
}

describe('EditorContextCapture', () => {
  it('captures an immutable selection with document version and zero-based range metadata', () => {
    const b = bench()
    const snapshot = b.capture.selection('/workspace')
    expect(snapshot).toEqual({
      id: 'capture-1',
      kind: 'selection',
      uri: 'file:///workspace/src/main.ts',
      workspacePath: 'src/main.ts',
      languageId: 'typescript',
      version: 7,
      range: { startLine: 0, startColumn: 6, endLine: 0, endColumn: 11 },
      text: 'value',
      capturedAt: 1_700_000_000_000,
    })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot?.range)).toBe(true)
    b.setText('later edit')
    expect(snapshot?.text).toBe('value')
  })

  it('returns null without a non-empty active selection or active file', () => {
    const b = bench()
    b.editor.selection = range(1, 2, 1, 2)
    expect(b.capture.selection('/workspace')).toBeNull()
    b.ports.activeEditor = () => undefined
    expect(b.capture.file('/workspace')).toBeNull()
    expect(b.capture.diagnostics('/workspace')).toBeNull()
  })

  it('captures unsaved active-file text and rejects values beyond each UTF-8 byte limit', () => {
    const b = bench('edited but unsaved')
    expect(b.capture.file('/workspace')).toMatchObject({ kind: 'file', text: 'edited but unsaved', version: 7 })
    b.document.getText.mockReturnValueOnce('😀😀')
    expect(() => new EditorContextCapture(b.ports, {
      maxSelectionBytes: 7, maxFileBytes: 128, maxDiagnostics: 2,
    }).selection('/workspace')).toThrow('selection exceeds the 7-byte limit')
    b.document.getText.mockReturnValueOnce('x'.repeat(129))
    expect(() => b.capture.file('/workspace')).toThrow('file exceeds the 128-byte limit')
  })

  it('refuses active documents outside the selected root', () => {
    const b = bench()
    b.document.uri = uri('/other/private.ts')
    expect(() => b.capture.file('/workspace')).toThrow('outside the selected workspace')
    b.document.uri = { ...uri('/workspace/untitled.ts'), scheme: 'untitled' }
    expect(() => b.capture.file('/workspace')).toThrow('outside the selected workspace')
  })

  it('captures bounded diagnostics with URI, range, severity, source, code, and message', () => {
    const b = bench()
    const capture = new EditorContextCapture(b.ports, {
      maxSelectionBytes: 32, maxFileBytes: 4_096, maxDiagnostics: 2,
    })
    b.ports.diagnostics = () => [
      {
        range: range(0, 1, 0, 4), severity: 0, source: 'ts', code: 2322,
        message: 'Type mismatch',
      },
      {
        range: range(2, 0, 2, 3), severity: 1, source: 'eslint',
        code: { value: 'semi' }, message: 'Missing semicolon',
      },
      {
        range: range(4, 0, 4, 1), severity: 2, message: 'truncated by count',
      },
    ]
    const snapshot = capture.diagnostics('/workspace')
    expect(snapshot).toMatchObject({ kind: 'diagnostics', uri: 'file:///workspace/src/main.ts' })
    expect(JSON.parse(snapshot?.text ?? 'null')).toEqual([
      {
        uri: 'file:///workspace/src/main.ts',
        range: { startLine: 0, startColumn: 1, endLine: 0, endColumn: 4 },
        severity: 'error', source: 'ts', code: 2322, message: 'Type mismatch',
      },
      {
        uri: 'file:///workspace/src/main.ts',
        range: { startLine: 2, startColumn: 0, endLine: 2, endColumn: 3 },
        severity: 'warning', source: 'eslint', code: 'semi', message: 'Missing semicolon',
      },
    ])
  })

  it('returns null without active-file diagnostics and bounds their serialized bytes', () => {
    const b = bench()
    expect(b.capture.diagnostics('/workspace')).toBeNull()
    b.ports.diagnostics = () => [{
      range: range(0, 0, 0, 1), severity: 3, message: 'x'.repeat(200),
    }]
    expect(() => b.capture.diagnostics('/workspace')).toThrow('diagnostics exceeds the 128-byte limit')
  })
})
