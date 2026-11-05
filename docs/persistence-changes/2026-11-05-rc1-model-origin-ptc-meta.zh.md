---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-05-rc1-model-origin-ptc-meta

[English](2026-11-05-rc1-model-origin-ptc-meta.md) | 中文

## 概述

记录可选的模型选择来源与已取消嵌套工具调用的结果元数据。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-05-rc1-model-origin-ptc-meta
baseline: false
changes:
  - root: "event:model/selection"
    previous: "2026-09-11-initial"
    after: "0c037e23a3d0620697e09e3de3b218de6d154ec13e3d2c362c1b7a06b12b1d42"
    decision: same-version
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-16-session-format-v4"
    after: "d66e11dddf5dfa3c71547e2cbd7b0608824cd8d6243fc16f532017ff28e8fba5"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有会话记录仍有效，写入格式保持不变。model/selection 事件缺少来源时仍表示显式选择；仅有请求头不代表用户固定了模型。派生的 modelSelection 缓存使用版本4，旧缓存从日志重新折叠以恢复这一差别。可选的 tool/ptc-dispatch meta 保留已启动调用被取消后的已知文件变更；缺少元数据不代表没有副作用或已经回滚。已冻结的兼容性代际与必需的分支事件均保持不变。

<a id="verification"></a>
## 验证

独立模型选择与 PTC 执行器测试24项通过；完整核心、Node 与技能源代码测试1540项通过、1项跳过；冷启动目录与入口测试75项通过；包含取消与嵌套图片的七组文件系统和 SSH 测试665项通过、3项跳过。扩大的文件系统覆盖率检查发现2个未改动格式化器分支缺口，已单独记录；变更文件的可执行计数均已覆盖。构建后的 Node 提供方冒烟测试4项通过。Host 包编译通过；Client 与安装产物集成验收另行进行。

<a id="dev-note"></a>
## 开发备注

无。
