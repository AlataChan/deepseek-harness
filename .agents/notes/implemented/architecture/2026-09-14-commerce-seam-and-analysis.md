# Agent Note: Commerce data uses a release seam, a single-writer binding event, and sqlite3-enforced analysis

Status: implemented

English | [中文](2026-09-14-commerce-seam-and-analysis.zh.md)

## Problem

Merchants want an assistant that analyzes their own store exports: orders, products, and inventory downloaded from platforms such as Taobao or Pinduoduo. Answers must rest on those files, the session's data source must survive replay, agents doing other work must not see commerce tools, and model-authored SQL must not read or write anything outside the imported data. Ask Data already decodes spreadsheets into SQLite, but its session binding belongs to its own controller and its query path belongs to a data-agent package.

## Decision

`@deepseek-ai/dsh-host-commerce` is the release-group Service Definition on `ctx.commerce`. It declares branded source, listing, and change ids, the closed `CommerceError` codes, imports, `platforms()`, the reads (`searchListings`, `getListing`, `salesSummary`, `inventoryHealth`, `analysisSchema`, `runAnalysisQuery`), and `renderExport`. Its concrete `bind(agent, sourceId)` is the only writer of the `commerce/bound` session event: it verifies the source through the provider, rechecks the `commerceBinding` projection at the commit point, and appends one event. The event is part of the generated persistence vocabulary, so replay reconstructs the binding.

`@deepseek-ai/dsh-experimental-commerce-mode` holds the Provider and its Consumers until a second provider exists. The Provider stores each source as one SQLite database with fixed `orders`, `products`, and `inventory` tables under `sourcesRoot`, maps platform headers to canonical columns through `Config.platforms`, and decodes spreadsheets through the built `@deepseek-ai/dsh-experimental-desktop-ask-data/spreadsheet` export. Each import writes a complete owner-only database file and keeps the previous database at a hard-linked backup until the manifest commit succeeds; a caught failure restores it, while a process crash between the database rename and the manifest rename can leave the new database under the previous manifest. The packaged sample imports its three tables as one commit. Imports hold a cross-process lock beside the manifest, so Hosts sharing `sourcesRoot` serialize their commits.

The sqlite3 process enforces analysis safety. Plugin load requires sqlite3 3.41.2 or newer and runs three probes in a temporary directory, which must refuse `readfile()`, `writefile()`, and `ATTACH` under `-safe`. Each query runs through `ctx.subprocess` as `sqlite3 -safe -readonly -nofollow -batch -bail -json <db> 'SELECT * FROM (<query>) LIMIT <maxRows+1>'` after a realpath and lstat check that the database is a regular file inside `sourcesRoot`; a stdout byte cap and a timeout terminate the process tree. The lexical check (one `SELECT` or `WITH`, no comments, no write or attach keywords) only produces the model-facing diagnostic. Recoverable refusals return held tool results with a correction step, and a SQLite execution refusal includes the bound source's schema.

The `./tools` Consumer registers `commerce_import_file`, `commerce_load_sample`, and five read tools. Every tool body refuses parented calls, resolves the binding from the projection, fences Provider values as external data within `maxResultChars`, and records returned listing ids in `tool/result.meta` only for search, full-listing, and inventory reads. The `commerceSession` projection folds binding and listing provenance from the log. Analysis rows never count as provenance because the query author chooses their columns.

Tool visibility follows the deployment's composition. In a deployment with an agent preset roster, such as Web and desktop, the `./preset` row installs the packaged `commerce` preset when absent and mounts `./tools` in the scope keyed by `agentPresets.standingKeyFor('commerce')`, so only agents on that preset see the tools. The packaged preset composition names release packages only and loads the `commerce-sales-analysis` skill from the installed preset directory. The headless, SDK, and ACP bundles compose no roster and create agents that read the global layer, so those deployments mount `./tools` as a root row. Cordis `inject` has no optional form, so each of the three rows declares a static set of required services.

## Alternatives considered

**An abstract bind with the session controller appending the event, as Ask Data does.** Rejected because every Consumer, including tools and controller remotes, would own an append path and repeat the commit-point recheck.

**An experimental Service Definition package.** Rejected because release applications must name the seam without depending on an experimental package; only the Provider is experimental.

**A shared spreadsheet-import package.** Rejected because Ask Data is the only other consumer; a built `./spreadsheet` export removes the duplication without a new package.

**Importing Ask Data `src/` paths.** Rejected because config subprocesses run built `lib/` code, and source subpaths are not a supported package interface.

**Relying on lexical SQL validation.** Rejected because SQL functions, pragmas, and attach forms outnumber any blocklist; sqlite3's safe, read-only, and no-follow modes enforce the restriction regardless of query text.

**Naming the experimental tools package in the packaged preset composition.** Rejected because preset compositions resolve against the harness base, where the experimental package is absent.

**Letting the Provider mount the tools under a scope option.** Rejected because the Provider would have to inject `agentPresets` in rosterless deployments, where no such service exists.

**Mounting the experimental Provider in the Python SDK scenarios.** Rejected because those scenarios run the `sdk-minimal` runtime, which composes release packages only.

## Consequences

Commerce binding and listing provenance are reconstructable from the session log, and a second provider can implement the seam without changing Consumers. SQL safety depends on host sqlite3 behavior, which the load probes check on every start; a host with an older or misbuilt sqlite3 cannot load the plugin. The lexical diagnostic can reject harmless queries whose literals contain forbidden words. A crashed import can leave the store lock behind, and later imports then time out until an operator removes it.

A deployment chooses tool visibility by row: a roster deployment adds `./preset`, and an automation profile adds `./tools`; a composition that adds both fails at load, because both rows claim the same tool-mount service. Recorded-session snapshots `commerce-sales-analysis` and `commerce-load-sample` pin the root mount, the skill text, and `commerce/bound` in the TypeScript SDK output; the Loader composition test pins preset-scoped visibility and disposal.
