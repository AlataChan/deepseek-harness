# @deepseek-ai/dsh-experimental-desktop-ask-data

English | [中文](README.zh.md)

Private octopus_DSH overlay: the Provider for [`ctx.askData`](../../host/ask-data/README.md) plus the Client occupant of `conversation.hero.askData` and `conversation.askData.gate`. Official `dsh-desktop-app` and the default `standard` assistant do not name this package. The desktop profile seed copies the built tree (`source: "workspace"` in [scripts/desktop-profile-plugins.json](../../../scripts/desktop-profile-plugins.json)).

The path is data first. 「问数」stages `data-agent` with `hold` and opens the gate. The empty page leads with **先用示例试一次**, then upload `.xlsx` / `.csv`, then **高级连接**. Import writes sqlite under the resolved profile home `data-sources/` and does not open a session. 「开始提问」calls `commitAskData`, which creates or reuses a session already bound through data-agent 0.1.3. Ordinary users never type a SQLite path on the happy path.

Hard limits live in `src/limits.ts` and appear on the page lead, beside upload, on preview, on failure recovery, and in the model-visible paragraph. Missing host `sqlite3` disables upload only; `importSample` copies `samples/sample-sales.sqlite`. Asking that file still needs data-agent's `sqlite3` CLI.

## Config

```yaml
- id: desktop-ask-data
  name: '@deepseek-ai/dsh-experimental-desktop-ask-data'
  config:
    dataHome: ''
```

Empty `dataHome` uses `{dshHome}/profiles/desktop/data-sources`. `cordis.patch.yml` inserts this one Host row. The Client half is discovered from `dsh.client` after the Host fiber is live.

## Model Experience

When `askDataBinding` is set, a dynamic `ask-data:limits` system-prompt section states the same rule ids. Cold resume sees it on the first assemble. Spreadsheet bytes never enter the session log.

#### KV Cache effect

The section text is stable for a bound session, so it does not churn the prefix after bind.

## Known Limitations and Deferred Work

- **No `.xls`, Numbers, Google Sheets, join, or ETL**
- **No empty SQLite on 问数 click**
- **No rewrite of leftover `dsh-context` user profiles** — companion boot must fail visibly
