---
description: "Discovers a real Node executable and the installed Harness package companion for the fork's desktop shell and VS Code extension, without executing dsh or a package-manager shim."
kind: "package-reference"
---

# `@deepseek-ai/dsh-installed-runtime`

## Summary

`installed-runtime` locates the Node executable and the installed Harness package companion that a native host needs to spawn the harness, without executing `dsh` or a package-manager shim. Callers supply the accepted package names and the `dsh.companions.*` key they need; the JSON CLI writes one object to stdout so a native shell can spawn the same resolution.

## Table of Contents

- [CLI](#cli)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## CLI

Accepted package names are caller-supplied; the VS Code extension and the desktop shell both accept `@deepseek-ai/dsh` and `@alatastudio/dsh`.

`lib/cli.js` is a self-contained file: a native shell can copy it alone and run it with a real Node executable. It writes one JSON object to stdout and never executes `dsh` or a package-manager shim. Required flags are `--companion vscode|desktop` and at least one `--accepted <package>`. Optional flags are `--runtime-path`, `--node-path`, and `--path`. Success prints `{ nodePath, packageRoot, companionEntry, runtimeVersion, discoveryPath }`. Failure prints `{ "error": "<message>" }` and exits 1.

## Model Experience

None, as this package only locates process launch paths and contributes no model context.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No package-manager execution** — a `.cmd` or `.ps1` Node path is refused; only recognized `dsh` shims are parsed as package clues.
- **Declared companion only** — the selected `dsh.companions.*` entry must be a JavaScript module that stays inside the installed package after `realpath`.

## Dev Note

The resolver ranks candidates by the package names callers accept and by the companion key the caller declares, so a second installation of the harness on the same machine cannot capture another host's launch. Extend the accepted-name list at the caller, not here; the CLI treats an unrecognized shim as a clue, never as authority.
