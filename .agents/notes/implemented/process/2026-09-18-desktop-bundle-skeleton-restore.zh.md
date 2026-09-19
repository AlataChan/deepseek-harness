# Agent Note: Restore a hollow octopus_DSH .app skeleton before signing

Status: implemented

[English](2026-09-18-desktop-bundle-skeleton-restore.md) | 中文

## Problem

`build-dmg.sh` 只要看到 `octopus_DSH.app` 目录就当它是完整的 Tauri 包。一次不完整的 `tauri build`、或之后丢掉 `Contents/MacOS`，都会留下带 `Info.plist` 和 `Resources` 的 Contents 树，而 `CFBundleExecutable` 仍写着 `dsh-desktop`，`CFBundleIconFile` 仍写着 `icon.icns`。接着嵌入 Node、harness、插件和 kb-runtime 会跑很久，然后 `verify-desktop-bundle.sh` 记下可执行文件缺失和嵌套 `installed-runtime-cli.js` 缺失，拒绝出 DMG。没有 `Contents/MacOS/dsh-desktop` 窗口起不来。没有 `Contents/Resources/icon.icns` 时 Finder 和 Dock 显示通用图标。Host 已接受扁平或嵌套 CLI；就绪检查只认 `Contents/Resources/resources/installed-runtime-cli.js`。工作区 pin 若连 `motion/` 和 `src/` 一起拷，还会把 DMG 撑大，并且首次启动回拷被打断时，现场 profile 副本可能没有 `package.json`。

## Decision

`build-dmg.sh` 在嵌入任何东西之前补回骨架文件。`Contents/MacOS/dsh-desktop` 不可执行时，把 `apps/desktop/src-tauri/target/release/dsh-desktop` 拷进该路径并加上可执行位。cargo 二进制也不在就退出。嵌套 CLI 缺失时，按顺序拷扁平 Tauri 资源、`apps/desktop/src-tauri/resources/installed-runtime-cli.js`、`packages/boot/installed-runtime/lib/cli.js` 中第一份存在的文件。`Contents/Resources/icon.icns` 缺失时，拷 `apps/desktop/src-tauri/icons/icon.icns`。官方 `apps/desktop` 产品代码不动。`seed-desktop-profile-plugin.mjs` 拷 `lib/`、`media/`、patch 和 samples，不拷 `src/`、`tests/`、`motion/` 和 `node_modules/.bin`。分阶段 npm install 曾把 `.bin` 做成指向已删除 `dsh-seed-deps-` 临时目录的断链；首次启动 `copy_dir_recursive` 因此失败，现场 `~/.dsh/profiles/desktop` 没有 `package.json`。`verify-desktop-bundle.sh` 仍要求 MacOS 二进制 `-x`、嵌套 CLI 和 `icon.icns` 为 `-f`，拒绝仍带 `motion/` 的 Hero pin，并区分「有文件但不可执行」和「文件不在」，以及「CLI 在扁平路径」和「CLI 完全没有」。

## Alternatives considered

**立刻失败，让操作者重跑 `cargo tauri build`。** 磁盘上已有 cargo release 二进制时拒绝：那就是打包器会拷的同一份可执行文件；对着已经组装过的空心 `.app` 再打一遍 Tauri 要几十分钟。

**只让就绪检查接受扁平 CLI。** 拒绝：Host 两条路径都认；门禁要保住 `build-dmg.sh` 写入的嵌套副本，而不是把漏嵌进去当成合格。

**改官方 `tauri.conf.json` 或 `build.rs`。** 拒绝：课期和外挂打包不得改官方桌面产品逻辑；空心骨架是打包脚本的失败。

## Consequences

空心 `.app` 只要还有 cargo release 二进制和仓库里的图标，就会变成带 Dock 图标、签过名的包，而不是嵌入很久之后就绪检查 `FAIL`。机器上没有 `target/release/dsh-desktop` 时仍在嵌入前失败。首次启动回拷不再把 100MB 的 oil-motion 帧写进 `~/.dsh`。写不写 DMG，仍由就绪检查最后决定。

## Testing

验证是 `pnpm exec vitest run scripts/seed-desktop-profile-plugin.spec.ts` 覆盖 payload 过滤，对补回后的 `octopus_DSH.app` 跑 `bash scripts/verify-desktop-bundle.sh`，再走 `scripts/build-dmg.sh` 的 DMG 步骤。没有空心 `.app` 的单元 fixture。
