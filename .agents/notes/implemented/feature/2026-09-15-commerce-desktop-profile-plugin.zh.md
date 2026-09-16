# Agent Note: 把电商模式打进 octopus_DSH 桌面 profile plugins

Status: implemented

[English](2026-09-15-commerce-desktop-profile-plugin.md) | 中文

## 问题

电商模式此前只存在于 `packages/experimental/`，配套自动化快照与源码 Web 通道。DMG seeding 读取 [scripts/desktop-profile-plugins.json](../../../../scripts/desktop-profile-plugins.json)，要求每个 pin 都是 dual-face 包（`dsh.bundle.patch` + `dsh.client` + 磁盘上的 `./client`），因此安装版里没有任何东西挂载电商 Provider、它的 preset、它的 tools 或 电商助手 页面。seeding 还会丢弃 pin 的 `workspace:` 传递依赖：即使 pin 本身拷贝无误，只有电商需要的 Host 包仍会缺席安装树。

## 决策

直接把 `@deepseek-ai/dsh-experimental-commerce-mode` 以 `source: "workspace"` 钉在 ask-data pin 之后。该包本身已具备两张面：`cordis.patch.yml` 挂载文件后端 Provider 与 `./preset` 行，后者安装打包的 `commerce` preset 并把电商 tools 挂在该 preset 的常驻作用域里；`./client` 提供变更卡片与带数据源门的 电商助手 chip。`@deepseek-ai/dsh-host-commerce` 进入 `apps/cli` dependencies，使 Service Definition 由 harness collect 解析，而不是依赖 Session Controller 的 peer 边。打包的虚构示例表与改编 skill 的 `NOTICE` 随 pin 的 `files` 一起发布；`verify-desktop-bundle.sh` 现在会在 seed 出来的电商副本缺少 preset 目录、示例表或 `NOTICE` 时让构建失败。

## 考虑过的替代方案

- **另建 desktop-commerce 包装包**，即 Agent Team 当初的做法。否决：电商模式本就是 dual-face，包装包只会多出一个无人认领的包和一份要对齐的版本号。
- **依赖 Session Controller 的 `dsh-host-commerce` peer 边来补闭包。** 否决：那条 peer 一变，安装树就会丢掉这道 seam；profile plugin 的 Host 依赖应当写进应用自己的 dependencies。
- **只 seed Provider，不要 `./preset` 行。** 否决：桌面组合带 preset 名册，而正是 preset 作用域把电商 tools 挡在其它 preset 之外。
- **把表格解码器复制进电商 pin。** 否决：ask-data 是同级 pin，已经带了它；复制一份既翻倍体积，又会在更新时分叉。Host 面直接 import `@deepseek-ai/dsh-experimental-desktop-ask-data/spreadsheet`。
- **让门页 import ask-data 的 client 字节辅助函数。** 被 client bundle 纯度门禁否决：浏览器 bundle 不得 value-import 同级插件的 `./client`，因为 module-table 身份按插件划分。页面改用 inline-safe 的 `@deepseek-ai/dsh-util-crypto` 的 `bytesToBase64` 折叠上传字节，并就地读取 `File`。

## 后果

- 桌面首次启动会把电商 bundle 合并进桌面 profile；用户删掉后不会被重新 seed，与其它 overlay 的规则一致。
- 安装版经 电商助手 chip 进入电商：示例或分表上传、分析、暂存变更、商家批准，最后把 CSV 写进会话 workspace。不向任何店铺发送数据。
- 电商 pin 一旦丢失 preset 目录、示例表或 `NOTICE`，打包门禁会在产出 DMG 之前失败。
- 实验包本身仍不进应用依赖闭包；应用新增的依赖只有 `dsh-host-commerce`，而 `apps/cli/tests/profile-link-bundle.spec.ts` 为 link 路径守住这条边界。
