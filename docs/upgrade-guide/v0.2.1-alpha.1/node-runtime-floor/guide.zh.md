---
kind: upgrade-guide
description: "源码检出与 companion 的 Node 解析现在要求 Node.js >=24.9.0，不再接受 ^22.19.0 或 >=24.0.0。"
---

# Node.js 24.9.0 是最低运行时

[English](guide.md) | 中文

## 变更

0.2.1-alpha.1 在根 `package.json` 的 `engines.node` 中接受 Node.js `^22.19.0 || >=24.0.0`。当前检出要求 `>=24.9.0`。Node.js 22、23，以及 24.0.0 到 24.8.x 会被拒绝。Node.js 24.9.0、24.14、当前的 24 线，以及 26 等更高主版本仍然可用。

从源码运行本仓库的人，以及在系统 Node 上启动 TypeScript SDK 或仅供开发的 Python node 载体的人，需要受支持的 Node。打包的桌面应用会自行准备 Node.js 24.14.0，不要求该用户安装 Node。已发布的 Python wheel 是 Node 24 可执行文件，仍然不需要系统 Node。这条下限是 Harness 检出的协同运行时策略，不是关于 Cordis 4.1 在 Node.js 22 上的证据。

## 迁移

1. 运行 `node --version`。若打印的版本更低，安装 Node.js 24.9.0 或更高版本。当前的 Node.js 24 线与 Node.js 26 都符合要求。Node.js 22、23，以及 24.0 到 24.8 不符合。如果已经使用版本管理器，选择该范围内的版本后再次运行 `node --version`。
2. 在本检出中确认根 `package.json` 的 `engines.node` 为 `>=24.9.0`。`dsh` 在选择 profile 之前调用 `assertSupportedNode(process.version)`。更旧的 Node 把诊断写到 stderr 并以退出码 1 结束。只通过 `dsh` profile 启动应用，例如 `pnpm dsh --profile headless`。
3. 打包桌面应用的用户不必安装 Node。`scripts/build-dmg.sh` 与 `scripts/build-exe.mjs` 将 `NODE_VERSION` 设为 `24.14.0`，应用会准备该运行时。
4. Companion 发现使用 `@deepseek-ai/dsh-installed-runtime` 的 `resolveInstalledRuntime`。不受支持的 Node 会使 JSON CLI 打印一行含 `>=24.9.0` 的 `{ "error": "..." }` 并以退出码 1 结束。受支持的 Node 执行 `node --version` 时打印 `v24.9.0` 或更高版本。
