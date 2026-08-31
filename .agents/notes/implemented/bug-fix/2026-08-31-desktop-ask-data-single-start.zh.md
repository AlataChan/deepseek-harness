# Agent Note: Ask-data shows one start control after a pick

Status: implemented

[English](2026-08-31-desktop-ask-data-single-start.md) | 中文

## Problem

问数页会在每一份名单源上画「开始提问」。用过两份源就出现两颗相同的主按钮。点其中一颗会绑上当前会话，再点另一颗就会失败，或者看起来像被踢回首页。

## Decision

名单行只负责点选。「开始提问」是页上唯一一颗，在用户点选一行（且该行找得到）或导入（示例 / 上传）之前不出现，出现后只提交这份源。预览只列表明细和警告，自己不再带开始按钮。名单拆分仍见 [去重开始按钮](2026-08-30-desktop-ask-data-duplicate-start.zh.md)。绑定复用仍见 [已绑定会话](2026-08-31-desktop-ask-data-rebind-session.zh.md)。

## Alternatives considered

**每行继续留一颗开始按钮。** 否决：页标题是「选一份要问的数据」；每行一颗相同的开始按钮正是这次被投诉的交互。

**默认选中最近一行并立刻画出开始按钮。** 否决：必须先有一次明确点选或导入，按钮才和那份文件绑定。

## Consequences

尚未点选时只提示点名单，不画开始按钮。覆盖在 `tests/data-source-page.client.spec.tsx`。
