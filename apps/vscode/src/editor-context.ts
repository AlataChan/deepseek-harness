/** Explicit, workspace-restricted VS Code editor snapshot capture. */

import { isAbsolute, relative, resolve, sep } from 'node:path'
import {
  EditorContextId,
  type EditorContextRange,
  type EditorContextSnapshot,
} from '@deepseek-ai/dsh-client-connection-vscode/protocol'
import type { ContextLimits } from './bridge-router.ts'

/** Explicit capture action shared by extension commands and IDE handlers. */
export type EditorCaptureKind = 'selection' | 'file' | 'diagnostics'

/** Structural VS Code position used by the testable capture core. */
export interface EditorPositionPort {
  line: number
  character: number
}

/** Structural VS Code range used by selections and diagnostics. */
export interface EditorRangePort {
  start: EditorPositionPort
  end: EditorPositionPort
}

/** Structural URI facts needed for selected-root enforcement and serialization. */
export interface EditorUriPort {
  fsPath: string
  scheme: string
  toString(skipEncoding?: boolean): string
}

/** Active text document read face. */
export interface EditorDocumentPort {
  uri: EditorUriPort
  languageId: string
  version: number
  getText(range?: EditorRangePort): string
}

/** Active editor read face. */
export interface ActiveEditorPort {
  document: EditorDocumentPort
  selection: EditorRangePort
}

/** Diagnostic value read from the VS Code language service. */
export interface EditorDiagnosticPort {
  range: EditorRangePort
  severity: 0 | 1 | 2 | 3
  message: string
  source?: string
  code?: string | number | { value: string | number }
}

/** Injected VS Code operations and deterministic identity/clock sources. */
export interface EditorContextPorts {
  activeEditor(): ActiveEditorPort | undefined
  diagnostics(uri: EditorUriPort): readonly EditorDiagnosticPort[]
  randomId(): string
  now(): number
}

function capturedRange(range: EditorRangePort): EditorContextRange {
  return Object.freeze({
    startLine: range.start.line,
    startColumn: range.start.character,
    endLine: range.end.line,
    endColumn: range.end.character,
  })
}

function workspacePath(root: string, uri: EditorUriPort): string {
  if (uri.scheme === 'untitled') throw new Error('active document is outside the selected workspace')
  const selected = resolve(root)
  const document = resolve(uri.fsPath)
  const path = relative(selected, document)
  if (path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error('active document is outside the selected workspace')
  }
  return path.split(sep).join('/')
}

function assertBytes(text: string, limit: number, kind: string): void {
  if (new TextEncoder().encode(text).byteLength > limit) {
    throw new Error(`${kind} exceeds the ${String(limit)}-byte limit`)
  }
}

function severityName(severity: EditorDiagnosticPort['severity']): string {
  switch (severity) {
    case 0: return 'error'
    case 1: return 'warning'
    case 2: return 'information'
    case 3: return 'hint'
  }
}

function diagnosticCode(code: EditorDiagnosticPort['code']): string | number | undefined {
  return typeof code === 'object' ? code.value : code
}

/** Extension-host owner of immutable selection, file, and diagnostic captures. */
export class EditorContextCapture {
  /**
   * @param ports - active-editor, diagnostics, identity, and clock operations.
   * @param limits - already validated extension context limits.
   */
  constructor(
    private readonly ports: EditorContextPorts,
    private readonly limits: ContextLimits,
  ) {}

  /**
   * Capture the current non-empty editor selection.
   * @param root - currently selected workspace root.
   * @returns immutable snapshot, or null without an active non-empty selection.
   */
  selection(root: string): EditorContextSnapshot | null {
    const editor = this.ports.activeEditor()
    if (editor === undefined) return null
    const { selection } = editor
    if (
      selection.start.line === selection.end.line
      && selection.start.character === selection.end.character
    ) return null
    const text = editor.document.getText(selection)
    assertBytes(text, this.limits.maxSelectionBytes, 'selection')
    return this.snapshot('selection', editor.document, root, text, capturedRange(selection))
  }

  /**
   * Capture the active document's current text, including unsaved edits.
   * @param root - currently selected workspace root.
   * @returns immutable snapshot, or null without an active editor.
   */
  file(root: string): EditorContextSnapshot | null {
    const editor = this.ports.activeEditor()
    if (editor === undefined) return null
    const text = editor.document.getText()
    assertBytes(text, this.limits.maxFileBytes, 'file')
    return this.snapshot('file', editor.document, root, text)
  }

  /**
   * Capture bounded diagnostics for the active document.
   * @param root - currently selected workspace root.
   * @returns immutable snapshot, or null without an active editor or diagnostics.
   */
  diagnostics(root: string): EditorContextSnapshot | null {
    const editor = this.ports.activeEditor()
    if (editor === undefined) return null
    const path = workspacePath(root, editor.document.uri)
    const uri = editor.document.uri.toString(true)
    const diagnostics = this.ports.diagnostics(editor.document.uri).slice(0, this.limits.maxDiagnostics)
    if (diagnostics.length === 0) return null
    const records = diagnostics.map((diagnostic) => {
      const code = diagnosticCode(diagnostic.code)
      return {
        uri,
        range: capturedRange(diagnostic.range),
        severity: severityName(diagnostic.severity),
        ...(diagnostic.source === undefined ? {} : { source: diagnostic.source }),
        ...(code === undefined ? {} : { code }),
        message: diagnostic.message,
      }
    })
    const text = JSON.stringify(records)
    assertBytes(text, this.limits.maxFileBytes, 'diagnostics')
    return Object.freeze({
      id: EditorContextId(this.ports.randomId()),
      kind: 'diagnostics',
      uri,
      workspacePath: path,
      languageId: editor.document.languageId,
      version: editor.document.version,
      text,
      capturedAt: this.ports.now(),
    })
  }

  private snapshot(
    kind: 'selection' | 'file',
    document: EditorDocumentPort,
    root: string,
    text: string,
    range?: EditorContextRange,
  ): EditorContextSnapshot {
    return Object.freeze({
      id: EditorContextId(this.ports.randomId()),
      kind,
      uri: document.uri.toString(true),
      workspacePath: workspacePath(root, document.uri),
      languageId: document.languageId,
      version: document.version,
      ...(range === undefined ? {} : { range }),
      text,
      capturedAt: this.ports.now(),
    })
  }
}
