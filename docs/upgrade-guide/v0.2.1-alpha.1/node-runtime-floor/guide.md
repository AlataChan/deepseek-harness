---
kind: upgrade-guide
description: "Source checkouts and companion Node resolution now require Node.js >=24.9.0 instead of ^22.19.0 or >=24.0.0."
---

# Node.js 24.9.0 is the minimum runtime

English | [中文](guide.zh.md)

## Change

Release 0.2.1-alpha.1 accepted Node.js `^22.19.0 || >=24.0.0` in the root `package.json` `engines.node` field. This checkout requires `>=24.9.0`. Node.js 22, 23, and 24.0.0 through 24.8.x are rejected. Node.js 24.9.0, 24.14, the current 24 line, and newer majors such as 26 stay supported.

People who run this repository from source, and people who start the TypeScript SDK or the dev-only Python node carrier on system Node, need a supported Node. The packaged desktop app provisions Node.js 24.14.0 and does not ask that user to install Node. The published Python wheel is a Node 24 executable and still does not require system Node. This floor is coordinated runtime policy for the Harness checkout. It is not evidence about Cordis 4.1 on Node.js 22.

## Migration

1. Run `node --version`. Install Node.js 24.9.0 or newer when the printed version is lower. The current Node.js 24 line and Node.js 26 both qualify. Node.js 22, 23, and 24.0 through 24.8 do not. If a version manager is already installed, select a version in that range and run `node --version` again.
2. In this checkout, confirm root `package.json` `engines.node` is `>=24.9.0`. `dsh` calls `assertSupportedNode(process.version)` before it selects a profile. An older Node prints the diagnostic to stderr and exits 1. Start only through a `dsh` profile, for example `pnpm dsh --profile headless`.
3. Packaged desktop users skip Node installation. `scripts/build-dmg.sh` and `scripts/build-exe.mjs` set `NODE_VERSION` to `24.14.0`, and the app provisions that runtime.
4. Companion discovery uses `resolveInstalledRuntime` in `@deepseek-ai/dsh-installed-runtime`. An unsupported Node makes the JSON CLI print one `{ "error": "..." }` line that names `>=24.9.0` and exit 1. A supported Node prints `v24.9.0` or newer from `node --version`.

The source Host compiler uses a 6 GiB V8 heap limit. The integrated Host test program measured about 4.3 GiB with extended diagnostics; the previous 4 GiB limit exhausted its heap. This build setting does not change the installed application runtime limit or omit tests.
