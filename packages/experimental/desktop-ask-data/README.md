# @deepseek-ai/dsh-experimental-desktop-ask-data

English | [中文](README.zh.md)

Private octopus_DSH overlay: the Provider for [`ctx.askData`](../../host/ask-data/README.md) plus the Client occupant of `conversation.hero.askData` and `conversation.askData.gate`. Official `dsh-desktop-app` and the default `standard` assistant do not name this package. The desktop profile seed copies the built tree (`source: "workspace"` in [scripts/desktop-profile-plugins.json](../../../scripts/desktop-profile-plugins.json)).

The path is data first. 「问数」stages `data-agent` with `hold` and opens the gate. The empty page leads with **先用示例试一次**, then **下载填写模板**, then upload `.xlsx` / `.csv`, then **连接已有数据库**. The page lists the fill-in pitfalls before the file picker. The template button copies the CSV (Tauri WebView has no download bar) and shows that it copied, or the text to copy. **连接已有数据库** closes the page and opens a data-agent session so the workbench trigger is visible; that session does not auto-reopen the page. After the user saves a connection they click 问数 again and pick it from the list. Import writes sqlite under the resolved profile home `data-sources/` and does not open a session. Listed rows are selectable and do not carry their own start control. One 「开始提问」 appears only after the user picks a row or imports (sample or upload), and it commits that source. `commitAskData` reuses an unbound blank session, or creates a new session when the current one is already bound to a different source; picking the source already bound on the current session just opens that session. Bind starts a Catalog scan so the first `catalog-search` does not throw empty. A recently used row is not repeated under 全部数据源; that section hides when every listed row is already recent. Ordinary users never type a SQLite path on the happy path.

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
