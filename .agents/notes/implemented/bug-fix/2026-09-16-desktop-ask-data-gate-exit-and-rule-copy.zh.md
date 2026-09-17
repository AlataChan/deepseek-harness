# Agent Note: 问数面板可退出、同名文件不再堆行、规则 id 退出用户文案

Status: implemented

[English](2026-09-16-desktop-ask-data-gate-exit-and-rule-copy.md) | 中文

## Problem

桌面问数面板报告了和知识库同样的两个缺陷，外加一处没人提过的泄漏。

面板并不总能退出。它没有关闭控件，chip 也不是开关：`registerGate` 在已有面板时直接返回，而 `openFromChip` 每次点击都会 stage preset，所以再点一次「问数」什么也不会发生。唯一的可见出口「取消」执行的是 `const refusal = await seat.select(previousPreset); if (refusal !== undefined) return`，于是只要宿主拒绝回退 preset，这个按钮就既不动作也不提示。

数据源名单会堆重复行。每次导入都会新建一个 `src-<uuid>` 行，所以 `用户信息.csv` 传两次，「最近使用」里就会出现两次同名文件；`replaceSourceId` 虽然存在，但只有 `missing` 行的「重新选文件」才会设置它。

四个面向用户的文案面各自都必须包含全部十二个内部规则 id —— `limits-copy.ts` 声明了那个封闭集合，它的测试断言每个面都含每个 id —— 于是页首和上传按钮上方那段会原样印出 `accept-xlsx-csv one-file-one-source first-row-header header-empty header-duplicate type-guess sheet-name file-size row-count decoded-cell csv-encoding no-merge-repair`，七条预览告警和 sqlite3 提示同样各自把 id 缀在句尾。

## Decision

页面在标题旁带一个关闭控件；chip 变成开关；而且退出不再等 preset 回退成功。preset 座位本来就会自己报出拒绝，而一个谁都关不掉的面板，比一个仍停在 data-agent 的会话更糟，所以「取消」现在总是清掉 stage 并关闭。

导入改为在 `kind === 'import'` 的行里按 basename 找自己那一行，所以同名文件再次上传会就地替换该行，并保留它的 `connectionRef` 和 `lastUsedAt`；显式传入的 `replaceSourceId` 仍然优先。一份文件始终是一个数据源，「最近使用」不会列出重复行。

规则 id 只面向模型。`rule-copy.ts` 把每条规则 id（`RULE_EXPLANATIONS`，以封闭 id 集合作键）、每个预览告警 id（`WARNING_KEYS`）和每个 seam 失败 code（`FAILURE_KEYS`）各映射到一个 locale key。`failureCopy` 读的是 Session Controller 放在失败 details 里的 seam code，因为所有 ask-data 失败到达浏览器时都是 `session/ask-data-failed`，业务 code 在 `details` 里；不认识的 code 回落到线上原文，不认识的预览告警回落到它自己的 id。`limits-copy.ts` 及其测试被删除，换成一套断言：每条规则 id 都有文案，且任何面向用户的字符串都不含规则 id。

`AskDataErrorCode` 从宿主 `index.ts` 移到共享的 `types.ts` 出口，由 `./client` 再导出。客户端聚合必须能命名这个 code 才能挑文案，而第一版直接引 `@deepseek-ai/dsh-host-ask-data` 会把 Host `AskData` 服务和 `dsh-session` 根一起拖进浏览器程序，使 `scope.sessions` 下的 `sessions` 服务被重新定型，整个客户端面随之编译失败。

## Alternatives considered

**保留早退，把拒绝显示在面板里。** 否决：那恰好把报告点名的困境留着。退出才是用户意图，而拒绝本来就有自己的展示面。

**只让 chip 变成开关，不加关闭控件。** 否决：面板是占据 composer 的接管层，会把输入栏藏起来，所以一个可见的关闭控件才是用户不需要知道 chip 是开关也能找到的入口。

**按 sqlite 内容而不是文件名去重。** 否决：文件可以改名，两个文件也可能同名，而名单显示的和用户指的就是文件名。文件消失时的替换已经由显式的重新选文件路径覆盖。

**同名上传直接拒绝并提示。** 否决：那会让同一个用户动作第二次就失败，而已有行带着值得保留的身份（`connectionRef`、`lastUsedAt`）。

**继续把 id 印进用户文案，好让每个面都点名每条规则。** 否决：那是把校验器词汇搬进 UI。原本的意图——没有一条规则会让用户一头雾水——由「以封闭规则 id 集合为键的 `RULE_EXPLANATIONS`」机械地保住。

**在 overlay 的客户端文件里镜像一份失败 code 联合类型。** 否决：镜像会与 seam 漂移。这个联合类型是两个面都要读的线上词汇，共享 types 出口才是它的家。

## Consequences

所有出口都能用：再点一次 chip、关闭控件、以及「取消」都能退出面板，任何 preset 拒绝都困不住它。一个文件名不再产生两行，保留下来的那一行保留它的连接绑定。

用户看到的原先是规则 id、现在是句子，中英一致；而往 `limits.ts` 里新增一条规则，不配好文案就编译不过。模型可见的 `ask-data:limits` 段落仍然点名这些 id —— 那才是它们该待的地方。

`@deepseek-ai/dsh-host-ask-data/client` 现在也导出 `AskDataErrorCode`，浏览器程序不再经由 overlay 加载宿主面。`limits-copy` 的导出从 overlay 的 `/client` 入口消失。验证见 `packages/experimental/desktop-ask-data/tests/rule-copy.client.spec.ts`（规则与 code 覆盖，加不含 id 的守卫）、`sources.spec.ts`（同名替换）、`data-source-page.client.spec.tsx`（关闭控件与句子文案面）、`apply.client.spec.ts`（chip 开关与被拒回退时仍能退出）。
