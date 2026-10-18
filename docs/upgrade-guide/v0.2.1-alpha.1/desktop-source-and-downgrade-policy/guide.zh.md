---
kind: upgrade-guide
description: 桌面产物核验要求记录源码修改标记，Windows 安装程序拒绝降级。
---

# 桌面源码状态与 Windows 降级

[English](guide.md) | 中文

## 变更

内部桌面构建允许使用修改后的源码。构建信息和发布清单记录 `sourceState.modifiedAtBuild` 与 `sourceState.modifiedAtPackaging`。公开构建要求两者均为 false。所有模式仍要求完整根构建的提交及 Client 产物摘要与打包输入一致。缺少这些标记的旧清单不能再用于产物核验；不得将缺失元数据解释为源码干净。

Windows 安装程序拒绝安装比已登记应用更旧的版本，包括静默安装。这可保护旧版本可能无法理解的持久化数据。拒绝降级时保留现有安装。

公共 macOS DMG 要求分开执行准备与签名阶段。准备阶段在导入签名凭据之前，使用临时签名运行捆绑程序就绪检查；签名只接收内容未变且通过就绪检查的输入。旧准备记录需要重新生成。

## 迁移

1. 组装桌面产物前运行 `pnpm run build:desktop:frontend`，或在单独进行 Tauri 构建前运行 `pnpm run build`。两种方式都会在构建 WebView 前生成完整构建记录。
2. 测试修改后的源码时使用内部模式。公开构建应从干净源码开始，并在打包期间保持不变。HEAD 变化后必须重新构建；新提交不能重新标记先前的二进制文件。
3. 重新构建并核验清单缺少 `sourceState` 的产物；仅编辑外部清单不能证明产物的源码状态。在 `build-info.json` 和外部 `.release.json` 中核对这些标记。
4. 在 Windows 上安装相同或更新版本。不要对正在使用的用户数据目录绕过降级拒绝。[桌面发布准备](../../../cookbook/desktop-releases.zh.md)说明了核验与恢复流程。

5. 公共 macOS 构建先运行 `bash scripts/build-dmg.sh --arch arm64 --prepare-only`，然后导入签名凭据，再将命令选项改为 `--sign-prepared` 执行。移除签名钥匙串后才能运行挂载后的捆绑程序检查。
