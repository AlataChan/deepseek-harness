---
kind: upgrade-guide
description: "Cordis Fiber config 改为提供原始输入，而非解析后的插件值。"
---

# 显式读取解析后的 Fiber 配置

[English](guide.md) | 中文

## 变更

`fiber.config` 和 `fiber.rawConfig` 保存插件的原始输入。解析后的默认值、转换结果和动态引用通过 `fiber.effectiveConfig` 读取。插件的配置参数仍然接收解析后的配置。通过 Fiber 检查其他插件的集成需要明确选择所需的数据表示。

## 迁移

1. 查找读取 `fiber.config` 或保留其对象身份的集成。读取插件实时值或动态引用时，改用 `fiber.effectiveConfig`，并根据配置所属插件的类型收窄其 `unknown` 类型。
2. 使用 `fiber.rawConfig` 读取原始输入，继续通过现有配置编辑器或更新路径保存修改。不要把解析后的引用序列化到配置文件中。
3. 测试省略的默认配置、原地更新的动态值，以及需要重新挂载插件的修改。确认设置显示解析后的值，而保存的配置仍然是普通输入。

原始配置与实际配置的 API 见 [Fiber 参考](../../../cordis-api/fiber.zh.md)。
