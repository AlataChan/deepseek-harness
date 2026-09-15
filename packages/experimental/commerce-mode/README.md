---
description: "Experimental file-backed commerce Provider: spreadsheet import, bounded read-only SQLite analysis, CSV rendering, and non-destructive preset installation."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-commerce-mode

English | [中文](README.zh.md)

## Summary

`dsh-experimental-commerce-mode` implements the [`ctx.commerce`](../../host/commerce/README.md) Provider over fixed `orders`, `products`, and `inventory` SQLite tables. It imports CSV or spreadsheet bytes through the supported Ask Data decoder entry, stores sources below the configured absolute `sourcesRoot`, serves fixed commerce reads, executes bounded read-only analysis queries, renders spreadsheet-safe CSV exports, and publishes two tool mounts: `./preset` installs the packaged `commerce` agent preset without replacing a user copy and mounts the native tools only in that preset's standing scope, while `./tools` mounts them at the Host root for a deployment without a preset roster. It has no Client surface.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the package only in an explicit experimental profile. `sourcesRoot` must be absolute. `platforms` maps each canonical field to an incoming spreadsheet header for each data kind; mappings are deployment configuration rather than Provider defaults, and they must include `sample`, the mapping for the packaged fictional sample. `analysis` sets row, output-byte, wall-clock, and termination-grace limits. `lockWaitMs` bounds how long an import waits for the source-store lock that serializes imports across Hosts sharing `sourcesRoot`. An empty `sqlite3Path` resolves `sqlite3` through the subprocess service. At load the Provider sets `sourcesRoot` to mode `0700`; the manifest is written owner-only and committed databases are owner read-only. The shipped patch supplies Taobao, Pinduoduo, Douyin Shop, Youzan, and fictional-sample mappings.

```yaml
- id: commerce-mode
  name: '@deepseek-ai/dsh-experimental-commerce-mode'
  config:
    sourcesRoot: !!js dshHomePath('commerce-sources')
    platforms:
      example:
        products: { listing_id: product_id, title: product_name }
        orders: { order_id: order_id, listing_id: product_id, quantity: quantity, gross_sales: paid }
        inventory: { listing_id: product_id, available: available }
      sample:
        products: { listing_id: listing, title: title }
        orders: { order_id: order, listing_id: listing, quantity: quantity, gross_sales: sales }
        inventory: { listing_id: listing, available: available }
    analysis:
      maxRows: 500
      maxOutputBytes: 1048576
      timeoutMs: 10000
      graceMs: 1000
    lockWaitMs: 60000

- id: commerce-preset
  name: '@deepseek-ai/dsh-experimental-commerce-mode/preset'
  config:
    maxResultChars: 50000
    maxListingIds: 200
    maxMetaBytes: 16384
    maxImportBytes: 33554432
```

Plugin load requires SQLite 3.41.2 or newer and independently verifies that `-safe` rejects `readfile`, `writefile`, and `ATTACH`. Analysis accepts one lexical `SELECT` or `WITH` statement, rejects comments and write-oriented keywords, verifies that the source database is a non-symlink regular file below the canonical source root, and executes `SELECT * FROM (<query>) LIMIT <maxRows + 1>` with `-safe -readonly -nofollow -batch -bail -json`. The caller's abort signal, wall-clock timer, and stdout byte meter all terminate the managed process tree.

The `./preset` and `./tools` rows take the same required `maxResultChars`, `maxListingIds`, `maxMetaBytes`, and `maxImportBytes` bounds. A deployment with a preset roster, such as Web or desktop, adds `./preset`; a headless, SDK, or ACP composition has no roster and adds `./tools` instead. A composition that adds both fails at load, because both rows claim the same tool-mount service. The import schema's platform enum comes from `ctx.commerce.platforms()`, which returns the configured `platforms` keys. `commerce_import_file` resolves a regular file inside the calling session workspace and rejects parent traversal, outside paths, and symbolic links before reading at most `maxImportBytes` bytes. A decoder failure is held as an input refusal; storage and process failures remain errors, and a caught failure before the manifest commit restores the previous database. The packaged sample imports its three tables as one commit.

`renderExport` returns CSV text and never writes a file. Text cells beginning with `=`, `+`, `-`, `@`, tab, or carriage return receive a leading apostrophe; finite numeric cells remain numeric. A Consumer owns approval and file creation.

On load, the `./preset` row copies `preset/commerce/` to `.agent-presets/commerce` only when the target is absent. It never overwrites an edited preset; a copy failure is logged with the manual source and destination, and no tools are mounted. The packaged composition names release packages only and loads the `commerce-sales-analysis` skill from the installed preset's `skills/` directory. After resolving that preset, the row mounts the `./tools` Consumer in a scope keyed by `agentPresets.standingKeyFor('commerce')`; disposing the row disposes that scope and all seven tool registrations. `NOTICE` and `preset/commerce/LICENSE-APACHE-2.0.txt` carry the attribution for skill text adapted from Claude Commerce Agents.

<a id="understand-the-implementation"></a>
## Understand the implementation

| Path | Responsibility |
|---|---|
| `src/provider/index.ts` | `Commerce` Provider, fixed reads, imports, serialized source mutations |
| `src/provider/analysis.ts` | lexical diagnostics, canonical-path checks, managed sqlite3 execution, startup probes |
| `src/provider/manifest.ts` | versioned manifest and deterministic database filenames |
| `src/provider/export.ts` | pure CSV rendering and formula neutralization |
| `src/install.ts` | non-destructive packaged-preset installation |
| `src/preset/index.ts` | `./preset` row: preset installation and standing-scope tool mount |
| `src/tools/index.ts` | native import/read tools, direct-call gates, bounded fenced rendering, and presentation metadata |
| `src/tools/projection.ts` | replay fold for binding and listing-read provenance |
| `preset/commerce/` | packaged agent preset and the `commerce-sales-analysis` skill |
| `cordis.patch.yml` | experimental Provider and `./preset` rows with platform mappings |

No runtime invariant companion is published because the Provider has no independently maintained observation of its manifest, database files, or service state that can diverge from an owned relation. Durable parsing and filesystem validation happen at each access.

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

With the `./preset` row, agents on the `commerce` preset see the seven generated [`commerce_*` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-commerce-mode) and agents on other presets see none of them; with a root `./tools` row, every agent sees them. `commerce_import_file` accepts a CSV or XLSX `path`, `kind` (`orders`, `products`, or `inventory`), and a `platform` enum containing the configured platform ids; `commerce_load_sample` accepts no fields. `commerce_search_listings` accepts optional `query` and required `limit`; `commerce_get_listing` accepts `listing_id`; `commerce_sales_summary` accepts optional `from` and `to`; `commerce_inventory_health` accepts no fields; and `commerce_analysis_query` accepts `query`.

#### Token effect

The seven schemas add a fixed cost for the agents that see them: agents on the `commerce` preset, or every agent under a root `./tools` row.

#### KV Cache effect

The schema prefix remains stable while the tool configuration and preset membership are unchanged.

### Skill catalog

#### What the model sees

Agents on the `commerce` preset list the `commerce-sales-analysis` skill with its frontmatter description. Loading it returns a method for naming the baseline and comparison period, confirming a movement before explaining it, attributing the change to a listing or product line, separating mix from level, checking stock, grading confidence, and structuring the answer, mapped to the `commerce_*` read tools. A root `./tools` row mounts no skill.

#### Token effect

The catalog entry adds the skill name and description; the skill body enters context only when the model loads it.

#### KV Cache effect

The catalog bytes stay stable while the installed preset's `skills/` directory is unchanged; editing the installed skill changes them from the next request.

### Tool-call history and results

#### What the model sees

Parented calls return “Commerce tools run as direct calls. Call this tool directly instead of from run_code.” Calls without an Agent return a normal held result that asks the model to start or resume a commerce session. Reads before binding return a normal held result that asks the model to call `commerce_import_file` or `commerce_load_sample` first. Loading the sample in a bound session holds and asks for a new commerce session because replacing the merchant's tables would lose data. Recoverable import, source, query-policy, timeout, and output-limit refusals are held with a correction step; provider detail copied into import or analysis holds is structurally escaped and fenced. A SQLite execution refusal also includes the bound source's current analysis schema. Invalid or missing stored sources disclose no internal path or manifest detail and ask for a new import in a new session; infrastructure failures remain errors. Every held result, including fenced provider detail, is bounded by `maxResultChars`. Successful Provider values are JSON-rendered, structurally escaped, wrapped in `<external-data>`, and bounded as complete renders by `maxResultChars`. Search, full-listing, and inventory reads persist at most `maxListingIds` provider-returned listing ids plus the `fullListing` flag in `tool/result.meta`; analysis queries never contribute listing provenance. A serialized metadata value above `maxMetaBytes` holds the call instead of truncating provenance. The `commerceSession` projection reconstructs the binding, all read listing ids, and full-listing reads from the session log.

#### Token effect

Each direct call appends its arguments and a result bounded by `maxResultChars`; held results use short stable recovery text.

#### KV Cache effect

Tool-call history is append-only and follows the reusable request prefix. This package adds no system-prompt section.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Host SQLite 3.41.2 or newer with working `-safe`, `-readonly`, and `-nofollow` support is required; the plugin fails at load when its version or denial probes do not satisfy the requirement.
- Imports replace one fixed table at a time and do not provide joins, arbitrary destination schemas, remote platform APIs, or live-store writes.
- A process crash between replacing a source database and committing the manifest can leave the new database under the previous manifest; caught failures restore the previous database, and a failed cleanup after a commit is only logged.
- A crashed import can leave `manifest.json.lock` in `sourcesRoot`; later imports time out after `lockWaitMs` until an operator removes that file.
- The lexical SQL diagnostic is intentionally conservative and can reject harmless comments or forbidden words inside literals; SQLite flags and canonical-path checks remain the execution enforcement.
- Commerce tools intentionally reject PTC sub-dispatch and other parented calls; child and out-of-process agents do not receive them unless they join the `commerce` preset or run in a composition with a root `./tools` row.
- Read tools hold until the session has been bound by `commerce_import_file` or `commerce_load_sample`.
- This private experimental package is not in a released application dependency closure.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
