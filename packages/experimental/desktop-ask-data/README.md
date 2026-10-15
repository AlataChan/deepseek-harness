---
description: "octopus_DSH desktop ask-data overlay: pick or import a data source before asking, keep spreadsheets in SQLite, and bind one source to a session through ctx.askData."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-ask-data

English | [中文](README.zh.md)

## Summary

`desktop-ask-data` is the private desktop overlay where a user picks or imports a data source before asking: it provides `ctx.askData`, occupies the 问数据 Hero, gate, and window brand slots, and owns the spreadsheet decoder other workspace packages import. Source rows come from the overlay store plus unmatched data-agent connections, and only 开始提问 commits a source to a session. The desktop profile seed installs it; official `dsh-desktop-app` and the default `standard` assistant do not name it.

## Table of Contents

- [Reuse spreadsheet import](#reuse-spreadsheet-import)
- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="reuse-spreadsheet-import"></a>
## Reuse spreadsheet import

Other workspace packages import `@deepseek-ai/dsh-experimental-desktop-ask-data/spreadsheet` instead of source paths. This supported entry exposes spreadsheet parsing, extension detection, SQLite table writing and preview reads, SQL identifier quoting, the `ParsedWorkbook` and `ImportedTable` types, and the accepted-extension, decoded-file, total-row, and decoded-cell limits. Parsing and SQLite failures remain `AskDataError` values with the codes declared by [`dsh-host-ask-data`](../../host/ask-data/README.md); the exported constants are Ask Data's decoder limits rather than Consumer-specific configuration.

<a id="config"></a>
## Config

```yaml
- id: desktop-ask-data
  name: '@deepseek-ai/dsh-experimental-desktop-ask-data'
  config:
    dataHome: ''
```

Empty `dataHome` uses `{dshHome}/profiles/desktop/data-sources`. `cordis.patch.yml` inserts this one Host row. The Client half is discovered from `dsh.client` after the Host fiber is live.

The General settings page places Brand mark next to Appearance. Three offline WebP presets update the sidebar and conversation Hero together: refined original B (default), abstract whale, and the character whale. The `brandMark` volatile preference is stored in the Host user-settings document, synchronizes across windows, and survives restarts; failed writes retain the accepted selection and report a toast. Restore default selects the refined original. The page previews sidebar and Hero placements. Assistant and team avatars are independent. System application icons remain fixed at build time; their source uses the refined original B. The master images are in `assets/assistant-brand`, generated with `scripts/build-assistant-brand-assets.mjs`.

## Model Experience

### Bound limits section

#### What the model sees

When `askDataBinding` is set, a dynamic `ask-data:limits` system-prompt section states the same rule ids. Cold resume sees it on the first assemble. Spreadsheet bytes never enter the session log.

#### Token effect

One section of fixed rule ids rides the prompt while the session stays bound; unbound sessions omit it.

#### KV Cache effect

The section text is stable for a bound session, so it does not churn the prefix after bind.

## Known Limitations and Deferred Work

- **No `.xls`, Numbers, Google Sheets, join, or ETL**
- **No empty SQLite on 问数据 click**
- **No rewrite of leftover `dsh-context` user profiles** — companion boot must fail visibly

### Dev Note

`RULE_EXPLANATIONS` is keyed by the closed rule-id set, so a new limit or preview warning ships only together with its operator sentence; no user-facing string carries a rule id, and every ask-data failure reaches the window through the `session/ask-data-failed` details code. Other workspace packages import the supported `/spreadsheet` entry rather than source paths, and its exported `AskDataError` codes must stay aligned with `dsh-host-ask-data`.
