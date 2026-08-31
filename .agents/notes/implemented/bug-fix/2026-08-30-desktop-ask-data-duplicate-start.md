# Agent Note: Ask-data list paints 「开始提问」 once per source

Status: implemented

English | [中文](2026-08-30-desktop-ask-data-duplicate-start.zh.md)

## Problem

After the sample had `lastUsedAt`, the 问数 gate painted the same row under 最近使用 and 全部数据源, each with 「开始提问」. Opening preview for that source added a third identical control.

## Decision

`DataSourcePage` splits the Host list: recent is `lastUsedAt` descending minus the open preview id; 全部数据源 is the remainder minus that same id and hides when empty. The start control is page-level after a pick or import; see [single start](2026-08-31-desktop-ask-data-single-start.md).

## Alternatives considered

**Keep 全部数据源 as the complete Host list.** Rejected: one used sample produced two identical start controls, which is what the screenshot showed.

**Hide only the duplicate button and keep the second row.** Rejected: the row itself is the duplicate.

## Consequences

A catalog that is only recently used sources shows one section. Unused imports still appear under 全部数据源. Client coverage is `tests/data-source-page.client.spec.tsx`.
