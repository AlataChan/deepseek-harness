# `@deepseek-ai/dsh-installed-runtime`

Discovers a real Node executable and an installed Harness package companion without executing `dsh` or a package-manager shim. Surfaces pass the accepted package names and the `dsh.companions.*` key they need. The JSON CLI writes one object to stdout so a native shell can spawn the same resolution.

Accepted package names are caller-supplied. The VS Code extension and the desktop shell both accept `@deepseek-ai/dsh` and `@alatastudio/dsh`.

## CLI

`lib/cli.js` is a self-contained file: a native shell can copy it alone and run it with a real Node executable. It writes one JSON object to stdout and never executes `dsh` or a package-manager shim. Required flags are `--companion vscode|desktop` and at least one `--accepted <package>`. Optional flags are `--runtime-path`, `--node-path`, and `--path`. Success prints `{ nodePath, packageRoot, companionEntry, runtimeVersion, discoveryPath }`. Failure prints `{ "error": "<message>" }` and exits 1.

## Model Experience

None, as this package only locates process launch paths and contributes no model context.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No package-manager execution** — a `.cmd` or `.ps1` Node path is refused; only recognized `dsh` shims are parsed as package clues.
- **Declared companion only** — the selected `dsh.companions.*` entry must be a JavaScript module that stays inside the installed package after `realpath`.
