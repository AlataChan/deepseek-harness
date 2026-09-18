# Agent Note: 机构常驻小队编制先于对话

Status: implemented

[English](2026-09-18-institution-standing-squads.md) | 中文

## Problem

Agent Teams 已经能把可续跑的队友留在 Lead Session 上，但用户入口只有会话内 spawn。文书组 / 案例组 / 传播部只存在于输入框启动话术里，所以新开一个话题看起来像再组一次队。机构常驻需要编制先于对话存在。

## Decision

Host 用文件名册（`$DSH_HOME/institution-squads.json`，或 `institutionCatalogPath`）保存三个产品常量小队。每行可选记录 Lead `SessionId` 以及座位上的 provider/model。`listInstitutionSquads` 在 persistence 里已经没有该 Session 时丢掉 Lead id。`ensureInstitutionSquad` 绑定调用方 Lead Session，并把编制里还没有的座位 spawn 一次。之后的话题是同一 Session 上的人类 prompt。

Client 用 `conversation.hero.agentTeam` 放三张小队卡片。派活时：未绑定就在 Hero 工作区创建 Session、命名、补齐座位并打开 Lead。座位下拉写入名册；Lead 已加载时必须显示现场 teammate model。页头舱仍是协作视图；底部启动按钮仍是现组路径，而且只填入输入框。

`institutionFreshProvider`（默认 `spawn`）是 Host 补座位时用的 continuable provider。官方 `apps/desktop`、`desktop-app` 与 companion 未改。

## Testing

Host spec 覆盖空名册、座位路线持久化、首次 ensure 与复用、过期 Lead 清除、队友调用方拒绝、仅 provider / 仅 model 座位路线、空座位对象、名册读写失败、以及未知小队/座位错误码。Client spec 覆盖无工作区禁用、创建-命名-ensure-打开、已在编复用、座位模型写入、列表/命名/ensure/创建/座位更新失败、以及忙碌时第二次点击无操作。会话骨架断言会渲染这个新的 Hero slot。

## Alternatives considered

**下一步先做 open-pstack 工种→模型设置页。** 否决：pstack 是把工种路由到模型。机构常驻是编制先于对话的具名花名册。

**每个话题新建一个 Session。** 否决：那等于再 spawn 一次，常驻上下文会丢。

**名册只存在 Client。** 否决：Lead 绑定和座位路线必须在 Client 刷新后仍由 Host 作准。

## Consequences

- 首页上第一个 Agent Team 入口是三支常驻小队，不是页头舱。
- 失败的座位名仍会占用该 Lead 上的 Team 名字槽；删掉 Lead Session 会清掉名册绑定，下次派活可以再创建 Lead。
- Typert remotes `listInstitutionSquads`、`updateInstitutionSeat` 与 `ensureInstitutionSquad` 属于实验性 Team contribution。
