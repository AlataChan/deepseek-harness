# Agent Note: Institutional Agent Team starter prompts

Status: implemented

English | [中文](2026-09-04-agent-team-institutional-starters.zh.md)

## Problem

The Team panel filled generic `researcher` / `writer` / list starters. NGO and institutional users need squad prompts that match real document, case-archive, and communications pipelines, while teammate `name` must stay lower-kebab-case.

## Decision

Replace the three fill templates with `document`, `case`, and `comms`. Each body assigns English kebab `name=` ids and Chinese duty text, requires shared-task ordering, forbids invented metrics, and keeps the Lead as coordinator (not final-draft author). Live topology and Archify remain separate layers; Archify stays opt-in via `@tt-a1i/archify-dsh` and is not a default desktop seed.

## Alternatives considered

- **Chinese strings as teammate `name`.** Rejected: roster validation requires `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`.
- **Preset-conditional templates only for 公益项目助手.** Deferred: institutional copy is clearer for all users; dual catalogs can wait.
- **Panel buttons that call `spawn_teammate`.** Rejected earlier: creation stays Lead-owned via chat.

## Consequences

- Users still edit the filled draft before send; nothing auto-submits.
- Follow-up slices: event-driven thin live graph on the same TeamView; optional Archify post-run maps.
