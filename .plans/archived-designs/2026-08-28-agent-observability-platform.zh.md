# Agent 可观测与控制平台实施计划

[English](2026-08-28-agent-observability-platform.md) | 中文

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 构建一套事件溯源的可观测平台，同时支持单会话诊断、团队级可靠性分析、策略化干预与受控回放评估，并且不向 `agent-loop` 添加行为。

**架构：** 确定性的 `sessionDiagnostics` projection 从权威 Session Event 日志派生带证据的 finding。浏览器 UI、实时 guard 策略、OpenTelemetry 导出与回放评估消费同一组 finding 字段；派生 finding 保持为可替换的 projection 状态，所有模型可见干预都使用已有的已记录消息或工具结果路径。团队分析使用有界 OTel metric 与 trace，metric label 不带 session id；只有回放证据明确支持某条规则后，才允许提升其自动干预级别。

**技术栈：** TypeScript、Cordis service 与 event、`@deepseek-ai/dsh-session-projection`、React slot 插件、Zod/Schemastery、OpenTelemetry Logs/Metrics/Tracing、Vitest、Loader composition test、ACP/headless/Web snapshot。

---

## 交付规则

- 以官方 GitHub stack 交付。下列每个阶段均可独立评审，并保持默认产品安全。
- 前四个阶段保持 `SessionEventMap` 不变。Finding 是确定性 projection；建议型干预成为带来源的普通 `user/message`，被阻止的调用仍是普通 `tool/result`。只有实现证明现有记录无法重建策略决定时，才增加持久事件。
- Telemetry 默认保持 `DISABLED`。启用导出时默认只发送 metadata；发送内容需要再次显式配置。
- 在 LLM capability 提供 provider-independent 定价来源前，不增加美元成本策略。Token、step、墙钟时间、错误数和工具调用预算属于本计划范围。
- 不把模型 judge 放进实时请求路径。可选 judge 只在 evaluation job 中运行，其输出不能单独授权实时干预。
- 每条规则都有稳定 code、severity、证据序号、阈值输入与确定性恢复条件。UI 文案由客户端本地化，不写入 projection 状态。

## 阶段 1——确定性 finding 与本地检查

### 任务 1：记录架构决策

**文件：**

- 新建：`.agents/notes/proposed/architecture/2026-08-28-agent-observability-control-plane.md`
- 新建：`.agents/notes/proposed/architecture/2026-08-28-agent-observability-control-plane.zh.md`
- 新建：`.agents/notes/proposed/architecture/2026-08-28-agent-observability-control-plane.i18n.yaml`

**步骤 1：编写 proposed Agent Note**

记录以下决策：

- 权威 Session Event 日志是唯一事实来源。
- `sessionDiagnostics` 是同步、plain-JSON projection，绝不把 finding 追加回日志。
- Finding 包含 `id`、`code`、`severity`、`status`、`firstSeq`、`lastSeq`、`evidenceSeqs`、`scope` 与数字/字符串 `facts`，不包含本地化 prose，也不复制消息或工具 payload。
- 策略消费 finding code 与独立 accounting projection，不能消费 UI 状态。
- 默认策略模式是 `observe`；`advise` 可以注入带来源 context；`enforce` 只适用于配置明确允许的确定性规则。
- Metric 排除高基数的 session、message、call、path 与 prompt 值。
- 回放评估拥有模型 judge 与策略晋级证据。

记录替代方案：仅提供 raw-log UI、持久化 finding event、实时 loop 中的模型 judge，以及单体外部监控服务。

**步骤 2：记录双语配对**

运行：

```sh
pnpm run verify-translation-pairing --write .agents/notes/proposed/architecture/2026-08-28-agent-observability-control-plane.md
```

预期：生成 consistency sidecar，配对通过。

**步骤 3：校验 Note**

运行：

```sh
pnpm run verify-agent-note-format
pnpm run verify-md-links
git diff --check
```

预期：全部通过。

**步骤 4：提交**

```sh
git add .agents/notes/proposed/architecture/2026-08-28-agent-observability-control-plane.*
git commit -m "docs: design the agent observability control plane"
```

### 任务 2：增加 `sessionDiagnostics` projection

**文件：**

- 新建：`packages/session/session-diagnostics/package.json`
- 新建：`packages/session/session-diagnostics/tsconfig.json`
- 新建：`packages/session/session-diagnostics/tsdown.config.ts`
- 新建：`packages/session/session-diagnostics/src/types.ts`
- 新建：`packages/session/session-diagnostics/src/projection.ts`
- 新建：`packages/session/session-diagnostics/src/index.ts`
- 新建：`packages/session/session-diagnostics/src/invariant.ts`
- 新建：`packages/session/session-diagnostics/tests/projection.spec.ts`
- 新建：`packages/session/session-diagnostics/README.md`
- 新建：`packages/session/session-diagnostics/README.zh.md`
- 新建：`packages/session/session-diagnostics/README.i18n.yaml`
- 修改：`packages/session/README.md`
- 修改：`packages/session/README.zh.md`
- 修改：`packages/session/README.i18n.yaml`
- 修改：`tsconfig.host.json`

**步骤 1：编写失败的 projection 测试**

覆盖首个封闭规则集：

```ts
type SessionDiagnosticCode =
  | 'repeated-tool-call'
  | 'consecutive-tool-errors'
  | 'tool-latency'
  | 'step-latency'
  | 'llm-retry'
  | 'abnormal-turn-end'
```

测试必须证明：

- 只有属性顺序不同的参数仍属于同一重复调用；
- 无关的已跟踪调用会关闭重复序列；
- 成功工具结果会关闭错误序列；
- 已完成的工具与 step 配对只在达到配置阈值时生成 latency finding；
- retry 与异常 turn-end 的证据指向精确 event 序号；
- 不感兴趣的 event 返回同一 state 引用；
- state 与 wire schema 拒绝畸形 finding；
- 证据受到上限约束，但不丢失 `firstSeq`/`lastSeq`；
- 单次 fold 与 checkpoint 恢复后的 fold 得到相同结果。

**步骤 2：运行聚焦测试并确认失败**

运行：

```sh
pnpm exec vitest run packages/session/session-diagnostics/tests/projection.spec.ts
```

预期：FAIL，因为 package 与 projection 尚不存在。

**步骤 3：实现公开字段与纯 fold**

使用 branded `SessionDiagnosticId`；由 `code`、scope identity 与 `firstSeq` 确定性派生。所有状态保持 JSON-compatible。

```ts
export interface SessionDiagnosticFinding {
  readonly id: SessionDiagnosticId
  readonly code: SessionDiagnosticCode
  readonly severity: 'info' | 'warn' | 'error'
  readonly status: 'active' | 'resolved'
  readonly firstSeq: number
  readonly lastSeq: number
  readonly evidenceSeqs: readonly number[]
  readonly scope: {
    readonly turn?: number
    readonly step?: number
    readonly callId?: string
    readonly tool?: string
  }
  readonly facts: Readonly<Record<string, string | number | boolean>>
}
```

`SessionDiagnosticsState` 可在 finding 之外保留紧凑 detector 工作状态，但 `wire.view()` 只返回 finding 与聚合计数。Config 拥有 `repeatWarnAt`、`errorRunWarnAt`、`slowToolMs`、`slowStepMs` 与 `maxEvidenceSeqs`；每个字段都在加载时校验并有文档化默认值。

**步骤 4：注册 projection**

把 `sessionDiagnostics` 合并进 `SessionProjectionStateMap` 与 `SessionProjectionMap`，从 `src/client.ts` 导出客户端安全类型，并通过 `ctx.sessionProjections.register()` 恰好注册一个 definition。

**步骤 5：通过 package 聚焦测试**

运行：

```sh
pnpm exec vitest run packages/session/session-diagnostics/tests
```

预期：PASS。

**步骤 6：更新 package 文档与编译引用**

记录配置、finding 语义、replay/checkpoint 行为、零直接模型影响，以及证据字段与本地化展示的区别。重新记录两组双语 README。

**步骤 7：提交**

```sh
git add packages/session/session-diagnostics packages/session/README* tsconfig.host.json
git commit -m "feat(session): derive evidence-backed diagnostics"
```

### 任务 3：在 base composition 中挂载 diagnostics

**文件：**

- 修改：`packages/bundle/base/cordis.patch.yml`
- 修改：`packages/bundle/base/package.json`
- 修改：`packages/bundle/base/tests/base.spec.ts`
- 新建：`packages/session/session-diagnostics/tests/loader-composition.e2e.ts`
- 新建：`examples/headless-agent/tests/fixtures/session-diagnostics.cordis.yml`
- 新建：`examples/headless-agent/tests/fixtures/session-diagnostics-driver.ts`

**步骤 1：编写真实 Loader 测试**

通过共享 subprocess launcher 启动 fixture，追加重复调用序列，请求 projection snapshot，并断言稳定 finding code 与 evidence seq。

**步骤 2：确认 composition 前测试失败**

运行：

```sh
pnpm exec vitest run packages/session/session-diagnostics/tests/loader-composition.e2e.ts
```

预期：FAIL，因为 Loader tree 尚无 diagnostics row。

**步骤 3：增加一个 base row**

在 `session-projection` 之后挂载 `session-diagnostics`。默认值留在插件的 `resolveConfig()`；bundle row 不重复 tunable 值。

**步骤 4：通过 composition 测试**

运行：

```sh
pnpm exec vitest run packages/session/session-diagnostics/tests packages/bundle/base/tests/base.spec.ts
```

预期：PASS。

**步骤 5：提交**

```sh
git add packages/bundle/base packages/session/session-diagnostics/tests examples/headless-agent/tests/fixtures/session-diagnostics*
git commit -m "feat(bundle): mount session diagnostics"
```

### 任务 4：增加 Diagnostics 会话视图与 Trajectory 证据链接

**文件：**

- 新建：`packages/client/ui-diagnostics/package.json`
- 新建：`packages/client/ui-diagnostics/tsconfig.json`
- 新建：`packages/client/ui-diagnostics/tsdown.config.ts`
- 在该 package 中新建：`src/client/index.ts`、`src/client/DiagnosticsView.tsx`、`src/client/DiagnosticsView.module.css` 与 `src/client/locales.ts`
- 在该 package 中新建：`src/index.ts`、`src/invariant.ts`、`tests/diagnostics-view.client.spec.tsx` 与 `tests/apply.client.spec.ts`
- 在该 package 中新建：`README.md`、`README.zh.md` 与 `README.i18n.yaml`
- 修改：`packages/client/ui-conversation/src/client/contract/views.ts`
- 修改：`packages/client/ui-conversation/src/client/stores.ts`
- 修改：`packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx`
- 修改：`packages/client/ui-trajectory/src/client/TrajectoryView.tsx`
- 修改：`packages/client/ui-trajectory/src/client/TrajectoryTable.tsx`
- 修改：`packages/client/ui-trajectory/tests/table.client.spec.tsx`
- 修改：`packages/bundle/client-app/cordis.patch.yml`
- 修改：`packages/bundle/client-app/package.json`
- 修改：`tsconfig.client.json`

**步骤 1：编写失败的组件测试**

证明该视图：

- 只读取 `useProjection('sessionDiagnostics')`；
- 把 active finding 排在 resolved finding 前，并确定性排序 severity；
- 显示 code 对应的本地化标题、解释、阈值事实与精确 evidence seq；
- 不仅依靠颜色表达 severity；
- 处理 projection 缺失与空 finding 列表；
- 通过现有一次性 conversation inspect channel 发送 `{ eventSeq }`。

**步骤 2：扩展 inspect target**

把共享 target 从 `{ callId }` 改为 discriminated union：

```ts
export type InspectTarget =
  | { readonly kind: 'tool-call'; readonly callId: CallId }
  | { readonly kind: 'event'; readonly eventSeq: number }
```

迁移现有 Chat 工具调用 handoff，并让 Trajectory 展开、选择、滚动到包含 `eventSeq` 的 record。只有 record 已加载后才清理一次性 target；若 seq 早于当前页，则逐页加载旧历史，直到找到或耗尽。

**步骤 3：实现 slot 插件**

注册 id 为 `diagnostics` 的 `conversation.view` entry，顺序位于 Trajectory 之后，提供双语 label，不增加 service。组件只通过标准 slot share 与 `inject` callback 接收数据。

**步骤 4：运行聚焦 browser unit 测试**

运行：

```sh
pnpm exec vitest run packages/client/ui-diagnostics/tests packages/client/ui-trajectory/tests packages/client/ui-conversation/tests
```

预期：PASS。

**步骤 5：增加 assembled Web snapshot**

扩展 keyless browser replay，使用产生一个重复工具 finding 与一个工具错误 finding 的 session。断言 Diagnostics tab、证据详情与证据到 Trajectory 的导航。

运行：

```sh
pnpm run test:web -- -g diagnostics
```

预期：审核新 snapshot 后 PASS。

**步骤 6：提交**

```sh
git add packages/client/ui-diagnostics packages/client/ui-conversation packages/client/ui-trajectory packages/bundle/client-app tsconfig.client.json apps/web/tests
git commit -m "feat(client): inspect session diagnostics"
```

## 阶段 2——实时预算与确定性干预

### 任务 5：用统一 diagnostic policy 替代独立 repeat reminder

**文件：**

- 新建：`packages/guard/diagnostic-policy/package.json`
- 新建：`packages/guard/diagnostic-policy/tsconfig.json`
- 新建：`packages/guard/diagnostic-policy/tsdown.config.ts`
- 新建：`packages/guard/diagnostic-policy/src/index.ts`
- 新建：`packages/guard/diagnostic-policy/src/config.ts`
- 新建：`packages/guard/diagnostic-policy/src/invariant.ts`
- 新建：`packages/guard/diagnostic-policy/tests/policy.spec.ts`
- 新建：`packages/guard/diagnostic-policy/tests/loader-composition.e2e.ts`
- 新建：`packages/guard/diagnostic-policy/README.md`
- 新建：`packages/guard/diagnostic-policy/README.zh.md`
- 新建：`packages/guard/diagnostic-policy/README.i18n.yaml`
- 修改：`packages/bundle/base/cordis.patch.yml`
- 修改：`packages/bundle/base/package.json`
- 证明 parity 后删除：`packages/guard/repeat-tool-reminder/`
- 修改：`packages/guard/README.md`
- 修改：`packages/guard/README.zh.md`
- 修改：`tsconfig.host.json`

**步骤 1：编写 policy matrix 测试**

使用三种模式：

```ts
type DiagnosticPolicyMode = 'observe' | 'advise' | 'enforce'
```

证明：

- `observe` 绝不改变请求或工具结果；
- `advise` 在配置次数复现现有 repeat-tool reminder；
- `enforce` 只在显式 allowlist 与显式阈值下阻止 finding code；
- diagnostics projection 缺失时，在插件加载或首个可解析 agent event 处明确失败；
- 每个 waterfall 都调用 `next()`，除非有意返回文档化的 block/reject decision；
- per-session 状态不会跨到 parent、child 或 sibling agent。

**步骤 2：实现 policy 消费**

通过 `ctx.sessionProjections.stateOf(agent.session, 'sessionDiagnostics')` 读取 finding。建议复用 `tools/post-execute` additional context，强制阻止复用其 block 结果。Advice 使用来源 `{ kind: 'plugin', plugin: 'diagnostic-policy', form: 'notice' }`，使模型可见干预可重建。

**步骤 3：删除前证明行为 parity**

让旧、新 package tests 运行相同 scripted 调用序列。只有新 advisory 输出与 reset 语义被现有 snapshot 层固定后，才删除 `repeat-tool-reminder`。

**步骤 4：替换 base row 并通过 Loader 测试**

默认使用 `mode: observe`。部署方必须显式 patch 才能启用 `advise` 或 `enforce`。

**步骤 5：提交**

```sh
git add packages/guard packages/bundle/base tsconfig.host.json
git commit -m "feat(guard): unify diagnostic policy enforcement"
```

### 任务 6：增加 per-turn 与 per-session 资源预算

**文件：**

- 修改：`packages/guard/diagnostic-policy/src/config.ts`
- 修改：`packages/guard/diagnostic-policy/src/index.ts`
- 修改：`packages/guard/diagnostic-policy/tests/policy.spec.ts`
- 修改：`packages/guard/diagnostic-policy/README.md`
- 修改：`packages/guard/diagnostic-policy/README.zh.md`
- 修改：`packages/guard/diagnostic-policy/README.i18n.yaml`
- 修改：`examples/headless-agent/tests/scenarios.ts`
- 新建：`examples/headless-agent/tests/snapshots/diagnostic-budget.jsonl`

**步骤 1：编写失败的预算测试**

分别覆盖以下可配置限制：

- 每 turn step 数；
- 每 turn 工具调用数；
- 每 session provider-reported token；
- 连续工具错误；
- 下一次请求前的 context-pressure ratio。

从 `sessionStats`、`tokenUsage` 与 `contextPressure` 读取 accounting，不重复其 fold。可选 projection 缺失时只令对应预算不可用并发出一次本地警告；已配置预算依赖的 projection 缺失则明确失败。

**步骤 2：实现 admission 行为**

- `observe`：不发布模型可见内容。
- `advise`：下一次请求前注入一条有界 warning。
- `enforce`：以可行动、带来源消息拒绝下一 step；不取消进行中的工具，也不修改已完成历史。

**步骤 3：增加 keyless assembled snapshot**

场景必须展示真实 runnable agent 达到工具调用预算、收到一条 notice，并且不进行额外模型请求而结束。固定 persisted JSONL，使干预来源与 turn closure 可审计。

**步骤 4：运行检查**

```sh
pnpm exec vitest run packages/guard/diagnostic-policy/tests
pnpm run test:snapshot -- -t diagnostic-budget
```

预期：PASS。

**步骤 5：提交**

```sh
git add packages/guard/diagnostic-policy examples/headless-agent/tests
git commit -m "feat(guard): enforce agent resource budgets"
```

## 阶段 3——隐私安全的团队 telemetry

### 任务 7：增加默认 metadata redaction policy

**文件：**

- 新建：`packages/session/session-telemetry-redaction/package.json`
- 新建：`packages/session/session-telemetry-redaction/tsconfig.json`
- 新建：`packages/session/session-telemetry-redaction/tsdown.config.ts`
- 新建：`packages/session/session-telemetry-redaction/src/index.ts`
- 新建：`packages/session/session-telemetry-redaction/src/invariant.ts`
- 新建：`packages/session/session-telemetry-redaction/tests/redaction.spec.ts`
- 新建：`packages/session/session-telemetry-redaction/README.md`
- 新建：`packages/session/session-telemetry-redaction/README.zh.md`
- 新建：`packages/session/session-telemetry-redaction/README.i18n.yaml`
- 修改：`packages/bundle/base/cordis.patch.yml`
- 修改：`packages/bundle/base/package.json`
- 修改：`docs/subsystems/session-telemetry.md`
- 修改：`docs/subsystems/session-telemetry.zh.md`

**步骤 1：编写 fail-closed redaction 测试**

定义 `contentMode: 'metadata' | 'diagnostic' | 'full'`，默认 `metadata`。

- `metadata` 删除消息文本、工具参数/结果、system prompt、schema、反馈文本、cwd 与本地路径；保留 event identity、类型、大小、计时、finish reason、error code、工具名、provider/model、usage 与 diagnostic code。
- `diagnostic` 额外允许经过 secret 与 path 替换的有界 error summary。
- `full` 保留内容，但仍应用配置的 key-name 与 value-pattern secret 清理。
- Redaction 异常通过现有 coordinator containment 丢弃该记录。

**步骤 2：实现一个 `session-telemetry/record` waterfall listener**

只转换 detached copy，绝不改写权威 Session 日志。需要聚合时增加结构化 metadata 字段，不使用占位 prose。

**步骤 3：在 OTel backend 前挂载 policy**

`DISABLED` 仍是 exporter 默认。上传时未显式设置 `contentMode`，只导出 metadata。

**步骤 4：更新 telemetry 文档与测试**

更新“默认没有挂载规则”的现行描述。为每类敏感 event 增加 invalid case，并重新记录双语配对。

**步骤 5：提交**

```sh
git add packages/session/session-telemetry-redaction packages/session/session-telemetry* packages/bundle/base docs/subsystems/session-telemetry*
git commit -m "feat(telemetry): redact exported sessions by default"
```

### 任务 8：从 ledger stream 投影 OTel trace 与 metric

**文件：**

- 修改：`packages/session/session-telemetry-otel/package.json`
- 修改：`packages/session/session-telemetry-otel/src/index.ts`
- 在该 package 中新建：`src/trace-fold.ts` 与 `src/metric-fold.ts`
- 修改：`packages/session/session-telemetry-otel/tests/otel.spec.ts`
- 在该 package 中新建：`tests/trace-fold.spec.ts` 与 `tests/metric-fold.spec.ts`
- 修改：`packages/session/session-telemetry-otel/README.md`
- 修改：`packages/session/session-telemetry-otel/README.zh.md`
- 修改：`packages/session/session-telemetry-otel/README.i18n.yaml`

**步骤 1：编写纯 reconstruction 测试**

从 ledger record 重建以下层次：

```text
session
└── turn
    └── step
        ├── llm request
        └── tool call
```

证明 success、retry、cancellation、timeout、final record 缺失、resumed stream、fork 与 feedback-only 历史 replay 的配对正确。

**步骤 2：定义有界 semantic 字段**

Metric：

- counter：turn、step、LLM request、retry、tool call、tool error、abnormal ending、diagnostic finding；
- histogram：TTFT、decode duration、step duration、tool duration、input/output/cache token；
- attribute：service version、provider、model、preset、tool name、finish category、finding code。

Metric 绝不附加 `session.id`、call id、prompt、path、error message 或 user id。Trace 与 log 在所选 redaction mode 下保留 correlation id。

**步骤 3：增加可选 SDK pipeline**

保持 logs 配置的职责兼容；metrics/traces endpoint 不完整时明确失败。每个 pipeline 拥有自己的 SDK processor，并加入现有有界 shutdown sequence。`DISABLED` 下不创建 provider。

**步骤 4：使用 in-memory exporter 测试**

断言精确 span 关系、timestamp、metric label、不存在禁止的高基数 attribute，以及最终 flush 行为。

**步骤 5：提交**

```sh
git add packages/session/session-telemetry-otel
git commit -m "feat(telemetry): export agent traces and metrics"
```

### 任务 9：交付 operator reference deployment

**文件：**

- 新建：`examples/observability/README.md`
- 新建：`examples/observability/otel-collector.yaml`
- 新建：`examples/observability/prometheus.yaml`
- 新建：`examples/observability/grafana/provisioning/datasources/datasources.yaml`
- 新建：`examples/observability/grafana/provisioning/dashboards/dashboards.yaml`
- 新建：`examples/observability/grafana/dashboards/dsh-agent-health.json`
- 新建：`examples/observability/docker-compose.yml`
- 新建：`examples/observability/tests/config.spec.ts`
- 修改：`examples/README.md`
- 修改：`examples/README.zh.md`

**步骤 1：编写静态配置测试**

拒绝 public bind address、默认 credential、缺失 health check、未知 metric name，以及使用禁止高基数 label 的 dashboard query。

**步骤 2：增加 local-only stack**

只在 loopback 暴露 collector、Prometheus、Tempo 与 Grafana。Dashboard 必须包含 reliability、latency、token/cache、tool health、diagnostic-code 与 version/model 对比 panel。

**步骤 3：增加可选 Docker smoke**

启动 stack，发送 fixture OTLP payload，查询一项 metric 与一条 trace，然后释放完整 stack。仅在 Docker 不可用时 self-skip。

**步骤 4：提交**

```sh
git add examples/observability examples/README*
git commit -m "docs(example): add the agent observability stack"
```

## 阶段 4——回放评估与安全策略晋级

### 任务 10：定义 evaluation capability

**文件：**

- 新建：`packages/evaluation/evaluation/package.json`
- 新建：`packages/evaluation/evaluation/tsconfig.json`
- 新建：`packages/evaluation/evaluation/tsdown.config.ts`
- 新建：`packages/evaluation/evaluation/src/index.ts`
- 新建：`packages/evaluation/evaluation/src/types.ts`
- 新建：`packages/evaluation/evaluation/src/invariant.ts`
- 新建：`packages/evaluation/evaluation/tests/service.spec.ts`
- 新建：`packages/evaluation/evaluation/README.md`
- 新建：`packages/evaluation/evaluation/README.zh.md`
- 新建：`packages/evaluation/evaluation/README.i18n.yaml`
- 修改：`packages/README.md`
- 修改：`packages/README.zh.md`
- 修改：`tsconfig.host.json`

**步骤 1：编写 Service Definition 测试**

定义 branded evaluation/run/candidate id 与以下最小请求：

```ts
export interface EvaluationRequest {
  readonly sourceSessionId: SessionId
  readonly atSeq: number
  readonly prompt: readonly PromptContentPart[]
  readonly candidates: readonly {
    readonly id: EvaluationCandidateId
    readonly agentPreset: string
  }[]
  readonly limits: {
    readonly timeoutMs: number
    readonly maxSteps: number
    readonly maxTokens: number
  }
}
```

结果包含 child session id、diagnostic、资源测量、world-verification 结果、可选 judge score，以及明确的 incomplete/cancelled/error state。重复 candidate id 与无效 boundary 在创建任何 child 前失败。

**步骤 2：只实现 capability contract 与 lifecycle**

`ctx.evaluations.run()` 返回 owned handle，支持 snapshot、subscription、cancellation 与 disposal。Service Definition 不创建 agent，也不选择 scoring strategy。

**步骤 3：测试 registration、重复 provider 拒绝、cancellation 与 disposer 行为**

**步骤 4：提交**

```sh
git add packages/evaluation packages/README* tsconfig.host.json
git commit -m "feat(evaluation): define replay evaluation capability"
```

### 任务 11：实现 session-fork evaluation provider

**文件：**

- 新建：`packages/evaluation/evaluation-session-fork/package.json`
- 新建：`packages/evaluation/evaluation-session-fork/tsconfig.json`
- 新建：`packages/evaluation/evaluation-session-fork/tsdown.config.ts`
- 新建：`packages/evaluation/evaluation-session-fork/src/index.ts`
- 新建：`packages/evaluation/evaluation-session-fork/src/run.ts`
- 新建：`packages/evaluation/evaluation-session-fork/src/invariant.ts`
- 新建：`packages/evaluation/evaluation-session-fork/tests/run.spec.ts`
- 新建：`packages/evaluation/evaluation-session-fork/tests/loader-composition.e2e.ts`
- 新建：`packages/evaluation/evaluation-session-fork/README.md`
- 新建：`packages/evaluation/evaluation-session-fork/README.zh.md`
- 新建：`packages/evaluation/evaluation-session-fork/README.i18n.yaml`

**步骤 1：编写 lifecycle 测试**

使用真实 `ctx.sessions.fork()` 语义与真实 `ctx.agents.createAgent()` transaction，只 mock LLM adapter 与 clock。证明：

- 每个 candidate 得到完全相同的 source prefix 与 prompt；
- candidate preset setup 在 publication 前挂载；
- candidate session 保持为具有可重建 lineage 的独立 child；
- 一个 candidate 失败不会取消 sibling，除非整个 run 被取消；
- timeout 与 token/step limit 会 quiesce 并 dispose 所有 owned AgentHandle；
- source session 绝不被修改；
- world verification 从外部读取文件或执行命令，不相信 assistant prose。

**步骤 2：实现有界 parallel candidate**

使用经过校验的 `concurrency` config。启动前创建 child id，但每个 child 只通过既有 agent creation transaction 发布。Evaluation 结果保存在 source Session history 外；child session 已保存自己的证据。

**步骤 3：增加确定性 scoring**

先只使用 rule-based 字段：completion state、negative feedback、diagnostic severity count、step、tool error、token 与 elapsed time。分别归一化字段；不折叠成无法解释的单一分数。

**步骤 4：把可选 judge scoring 增加为独立 provider hook**

Judge 只接收经过 redaction 的 deliverable 与 verification 结果，不能获得 raw credential 或无限制 workspace access。其分数标记为 nondeterministic，不能单独晋级 policy。

**步骤 5：通过真实 composition 与 built-artifact 测试**

**步骤 6：提交**

```sh
git add packages/evaluation/evaluation-session-fork
git commit -m "feat(evaluation): compare agents from session forks"
```

### 任务 12：增加 evaluation UI 与结果对比

**文件：**

- 新建：`packages/client/ui-evaluation/package.json`
- 新建：`packages/client/ui-evaluation/tsconfig.json`
- 新建：`packages/client/ui-evaluation/tsdown.config.ts`
- 在该 package 中新建：`src/client/index.ts`、`src/client/EvaluationView.tsx`、`src/client/EvaluationView.module.css` 与 `src/client/locales.ts`
- 在该 package 中新建：`src/index.ts`、`src/invariant.ts` 与 `tests/evaluation-view.client.spec.tsx`
- 修改：`packages/api/remotes/src/types.ts`
- 修改：`packages/api/remotes/src/index.ts`
- 修改：`packages/api/remotes/src/client/index.ts`
- 修改：`packages/client/runtime/src/client/contract/sessions.ts`
- 修改：`packages/client/runtime/src/client/sessions/service.ts`
- 修改：`packages/bundle/client-app/cordis.patch.yml`
- 修改：`packages/bundle/client-app/package.json`
- 修改：`tsconfig.client.json`

**步骤 1：增加 typed remote operation**

暴露 start、inspect、cancel 与 dispose operation，以及 streamed snapshot。校验每个 wire request，并始终使用 branded id。

**步骤 2：编写 UI 测试**

Comparison table 以 candidate 为列，以 diagnostic、completion、step、token、latency、tool error、verification 与 judge 结果为独立行。绝不以零隐藏缺失数据。提供到每个 child Session Diagnostics 与 Trajectory view 的链接。

**步骤 3：增加 keyless browser snapshot**

使用三个 scripted candidate：一个成功、一个工具循环、一个 timeout。固定 start、live progress、comparison、cancellation 与 child navigation。

**步骤 4：若 remote protocol 改变 SDK generated output，则更新两套 SDK projection**

运行 TypeScript JSON-RPC 与 Python single-executable snapshot generator，并审核 diff。

**步骤 5：提交**

```sh
git add packages/client/ui-evaluation packages/api/remotes packages/client/runtime packages/bundle/client-app examples/jsonrpc-agent scripts/snapshots/python-sdk-single-exe apps/web/tests tsconfig.client.json
git commit -m "feat(client): compare replay evaluations"
```

### 任务 13：增加基于证据的 policy promotion

**文件：**

- 新建：`packages/evaluation/evaluation-policy-report/package.json`
- 新建：`packages/evaluation/evaluation-policy-report/tsconfig.json`
- 新建：`packages/evaluation/evaluation-policy-report/tsdown.config.ts`
- 新建：`packages/evaluation/evaluation-policy-report/src/index.ts`
- 新建：`packages/evaluation/evaluation-policy-report/src/report.ts`
- 新建：`packages/evaluation/evaluation-policy-report/tests/report.spec.ts`
- 新建：`packages/evaluation/evaluation-policy-report/README.md`
- 修改：`packages/guard/diagnostic-policy/README.md`
- 修改：`packages/guard/diagnostic-policy/README.zh.md`

**步骤 1：定义晋级证据**

只有 report 包含以下内容时，才可建议把规则提升到 `advise` 或 `enforce`：

- baseline 与 candidate policy 配置；
- sample count 与 task strata；
- completion、world-verification、resource 与 diagnostic delta；
- false-positive 示例；
- confidence interval 或明确的 “insufficient sample” 结果；
- 阻止晋级的每个 regression threshold。

**步骤 2：编写失败的统计与安全测试**

覆盖 zero sample、strata 失衡、被平均数隐藏的 regression、全部 timeout candidate、judge-only improvement，以及安全的确定性提升。

**步骤 3：生成 report，绝不修改 deployment config**

Package 输出 JSON 与 Markdown artifact。由人应用建议 patch。在另行完成 approval 与 rollback 设计前，自动修改配置不属于范围。

**步骤 4：提交**

```sh
git add packages/evaluation/evaluation-policy-report packages/guard/diagnostic-policy/README*
git commit -m "feat(evaluation): report policy promotion evidence"
```

## 阶段 5——最终集成与发布门禁

### 任务 14：验证完整 assembled product

**文件：**

- 修改：`.agents/notes/proposed/architecture/2026-08-28-agent-observability-control-plane.md`
- 修改：`.agents/notes/proposed/architecture/2026-08-28-agent-observability-control-plane.zh.md`
- 实施后移动：两个 Note 与 sidecar 到 `.agents/notes/implemented/architecture/`
- 修改：`docs/architecture.md`
- 修改：`docs/architecture.zh.md`
- 修改：`docs/subsystems/README.md`
- 修改：`docs/subsystems/README.zh.md`
- 新建或重新生成：变更 public type 所要求的 owning subsystem 与 generated Cordis reference

**步骤 1：运行聚焦行为测试**

```sh
pnpm exec vitest run packages/session/session-diagnostics/tests packages/guard/diagnostic-policy/tests packages/session/session-telemetry-redaction/tests packages/session/session-telemetry-otel/tests packages/evaluation/evaluation/tests packages/evaluation/evaluation-session-fork/tests packages/evaluation/evaluation-policy-report/tests packages/client/ui-diagnostics/tests packages/client/ui-evaluation/tests
```

预期：PASS。

**步骤 2：运行 assembled presentation 与 protocol 检查**

```sh
pnpm run test:snapshot -- -t 'diagnostic|evaluation'
pnpm run test:web -- -g 'diagnostic|evaluation'
```

预期：审核 snapshot 后 PASS。

**步骤 3：运行 published-path 与文档检查**

使用 `dsh-pre-push-checks` 根据最终 outgoing diff 选择检查。至少运行：

```sh
pnpm run doc-sync
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run hygiene
git diff --check
```

预期：PASS。只有显式演练 CI coverage gate 时才运行 `pnpm run test:coverage`；普通本地交付使用聚焦测试。

**步骤 4：把 Agent Note 更新为 shipped reality**

把完整 triplet 从 `proposed/architecture` 移到 `implemented/architecture`，修改 `Status`，用已实施的 decision 与 consequence 替换 proposal/acceptance prose，并重新记录双语 sidecar。

**步骤 5：提交文档与 generated reference**

```sh
git add .agents/notes docs packages/*/README* packages/*/*/README*
git commit -m "docs: publish the observability platform architecture"
```

## 发布顺序与成功标准

1. **Developer preview：** 任务 1–4。用户可以看到 finding、理解证据，并跳到准确 Trajectory record。
2. **Safe control preview：** 任务 5–6。默认保持只观察；显式 patch 才启用建议或确定性强制。
3. **Team operations preview：** 任务 7–9。Metadata-only 导出在不发送 prompt 或 workspace 内容的前提下产生有用可靠性 dashboard。
4. **Evaluation preview：** 任务 10–12。同一 source boundary 可以运行多个 preset 并比较已验证结果。
5. **Governance release：** 任务 13–14。策略变化需要测量证据并由人应用；不存在 live model judge 或静默自修改。

当同一个 diagnostic code 能从 persisted Session 重现、在本地以精确证据展示、在不使用高基数 metric label 的前提下计数、被显式启用的 live policy 使用，并且能在不修改 source Session 的条件下跨 replay candidate 对比时，平台即告完成。
