# Agent Note: octopus_DSH 默认以 DISABLED 发布会话遥测

Status: implemented

[English](2026-10-06-fork-telemetry-disabled-default.md) | 中文

## Problem

`octopus_DSH` 以自持桌面应用分发，其前提是新用户只配置一个 API Key，别的不做。在此次改动之前，它的共享 base 把未设置的 `DSH_TELEMETRY_MODE` 解析为 `FEEDBACK_ONLY`，生产端点为 `https://harness-telemetry.deepseeksvc.com/v1/logs`。因此用户录制 `/feedback` 时，会把尚未共享的会话日志记录上传到由上游 DeepSeek 运营的 collector。本 fork 自己的维护者读不到那个 collector，所以这次上传对这个发行版没有任何诊断收益；而被导出的记录是**原始捕获副本**——共享 base 没有挂载 `session-telemetry/record` 脱敏规则，因此其中可能包含消息正文、工具参数与结果、以及工作区路径。披露文案出现在 `/feedback` 确认中，也就是用户在上传已经被触发之后才读到。

[feedback-gated 默认](../../archived/feature/2026-08-25-feedback-gated-telemetry-default.md)是为一个自己接收反馈的部署写的。原样搬进一个运营方不同的 fork，等于把会话记录交给了第三方，却没有同时把"能够据此行动"的能力交过来。

## Decision

**共享 base 把未设置的 `DSH_TELEMETRY_MODE` 解析为 `DISABLED`，且 exporter 行不再带端点默认值。** 于是上传模式成为一个需要两部分组成的、刻意的部署行为：把 `DSH_TELEMETRY_MODE` 设为 `FEEDBACK_ONLY` 或 `FULL`，并把 `DSH_TELEMETRY_OTLP_URL` 设为运营方自己控制的端点。上传模式缺少端点会在插件加载时失败，因为该插件的 `url` 在 `DISABLED` 之外是必填的；这个失败正是预期结果，替代方案只能是猜一个目的地。

**`FEEDBACK_ONLY` 保留，不删除。** 对于自建 collector、并希望 `/feedback` 报告携带其所描述会话的部署，它仍然是正确的模式。接缝、共享状态词汇、`DSH_TELEMETRY_DISABLED` 这一加载前硬退出、匿名用户 id、以及关闭时的排空上界均未改动；改的只是默认值与端点。

**录制 `/feedback` 保持本地，并明确告知。** 插件在该模式下已经会选择 `DISABLED_FEEDBACK_WARNING`，因此用户会得知没有共享任何内容，而不是误以为已经共享。这正是 [default-off 决定](../../archived/feature/2026-08-10-telemetry-default-off.md)确立的行为，也是本 fork 重新发布的默认值。

## Consequences

- 全新安装不会联系任何遥测端点。录制 `/feedback` 不上传任何内容，并报告未上传任何内容。
- 需要诊断型反馈的部署现在必须显式加入，并指定自己的端点。[feedback-gated 默认](../../archived/feature/2026-08-25-feedback-gated-telemetry-default.md)记录了该模式为何存在；本 note 只改变了由谁来选择它。
- 上游的 `dsh-otel` 挂载与 `@deepseek-ai/dsh-host-product-telemetry-otel` 继续处于本 fork 的发行组合之外。合并若重新引入其中任何一个，或在本行上重新引入 collector 默认值，都属于违规而非偏好：`scripts/verify-upstream-intake.ts` 读取 `scripts/upstream-intake-registry.ts`，对未登记的挂载直接失败。
- exporter 行仍然存在且仍被挂载，因此加入路径无需改动组合，只需配置。在禁用的同时保留该行是刻意的：移除该行会同时移除加入路径所用的接缝。
- 验证是对 exporter 的断言，而不是观测：默认配置下，启动时以及录制 `/feedback` 之后都不会发出 OTLP 请求；设置了 `DSH_TELEMETRY_DISABLED` 时，任何模式下都不发出。

## Alternatives considered

- **保留 `FEEDBACK_ONLY`，接受上游 collector。** 这是此前的发布状态。不采纳：诊断的正当性要求接收方是其读者所能控制的，而本 fork 的维护者读不到那个 collector，同时上传仍然暴露原始会话记录。
- **默认指向自建端点。** 不采纳，因为这不是一个默认值：指定一个没人运行的端点意味着每次安装都指向空处，而按部署选择目的地正是 `DSH_TELEMETRY_OTLP_URL` 存在的理由。
- **彻底删除 exporter 行。** 不采纳，因为它会连同默认值一起移除加入用的接缝，并会把 `DSH_TELEMETRY_MODE` 的含义从"策略"悄悄变成"不支持"。
- **增加上传前确认，使 `FEEDBACK_ONLY` 站得住。** 可行，而且这正是 [feedback-gated 默认](../../archived/feature/2026-08-25-feedback-gated-telemetry-default.md)自己为"要求事先知情同意的部署"所指出的替代方案。不采纳，因为确认框仍然通向一个本 fork 不运营的端点，它只会把一处数据处理上的错配，转换成一个用户无法评估的对话框。
