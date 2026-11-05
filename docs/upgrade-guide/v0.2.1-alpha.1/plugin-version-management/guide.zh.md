---
kind: upgrade-guide
description: 插件管理客户端增加显式版本远程方法和必填的 updatable 列表字段。
---

# 插件版本管理

[English](guide.md) | 中文

## 变更

Plugin Manager 新增 `listVersions` 和 `updateBundle`，插件包列表包含 `updatable`。自行构造 `BundleInfo` 的客户端必须提供此布尔值。现有插件页支持用户主动检查版本，并在确认选定版本后更新。发行版固定包保持锁定；不会后台检查或自动更新。

## 迁移

1. 为自定义 `BundleInfo` 数据源和测试数据补充 `updatable`，沿用 Host 列表的判断，不要为固定包启用更新控件。
2. 重新生成 Plugin Manager 远程客户端。展示进度时订阅 `plugin-manager/update-state`，分别保留 `result` 和 `restore`。
3. 在 `plugin-manager` 的 `lockedBundles` 配置中提供发行版固定包名；替换配置时保留此列表。
4. 验证打开插件页不检查版本，固定包不显示版本区域，且确认后的更新展示结果。没有 HMR 时，出现下次启动生效提示后重启 profile。
