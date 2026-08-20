# @deepseek-ai/dsh-client-ui-vscode

English | [中文](README.zh.md)

VS Code-only Client UI plugin for explicit editor context and extension-selected Workspace navigation. It adds one compact menu to the conversation composer, registers the `ide-context` reference codec, and consumes only the typed `vscodeIde` methods and events provided by the embedded Webview shell.

Selection, active-file, and active-file diagnostic actions capture immutable snapshots in the extension host. The Webview retains each accepted snapshot by its opaque id and inserts an ordinary reference chip into the current draft. Submission serializes every chip into escaped `<ide_context>` text and sends the resulting prompt through the existing Session path. A missing snapshot or failed serialization blocks submission; it never falls back to the shorter clipboard label.

The selected extension root is registered through `workspaces.create`, connected through `workspaces.connectWorkspace`, and opened through `sessions.open`. Root changes are serialized so one failed selection cannot poison a later restart.

## Model Experience

### Explicit editor snapshot

#### What the model sees

An explicitly attached snapshot becomes ordinary logged user-message text. The model receives the captured content and its URI, optional Workspace-relative path, language, document version, and range inside one `<ide_context>` block. No active editor, selection, unsaved text, or diagnostic is supplied implicitly.

#### Token effect

Each accepted chip adds one escaped metadata line, the exact bounded snapshot text, and one closing line to the submitted user message. Opening the menu or capturing context without submitting adds no model tokens.

#### KV Cache effect

Editor context changes only the user-message suffix for the submission containing it. The plugin adds no system-prompt section.

## Known Limitations and Deferred Work

- Captures live only in the retained Webview and are lost on view disposal, window reload, or extension-host restart.
- Diagnostic captures cover the active file, not every file in the Workspace.
- The `@` source is explicit-action-only in version 1 and contributes no candidate-menu rows.
