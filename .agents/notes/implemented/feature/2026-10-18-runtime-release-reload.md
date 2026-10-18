# Agent Note: Refuse Client modules from another Host runtime release

Status: implemented

English | [中文](2026-10-18-runtime-release-reload.zh.md)

## Decision

The graph carries a Host runtime release, separate from plugin revisions and the Tauri shell version. The shared desktop build producer reads the CLI runtime version and full source commit. Complete Git builds expose these as `DSH_CLIENT_RELEASE_VERSION` and `DSH_CLIENT_RELEASE_COMMIT`; the existing short `DSH_CLIENT_COMMIT_HASH` remains display metadata. Node and browser artifacts embed the release fields, and desktop artifact metadata uses the same producer.

The Tauri bootstrap retains the installed-manifest/companion runtime-version refusal and additionally compares the graph version before caching or loading factories. Local-cache URL rewriting preserves the graph release. After boot, the page compares a shallow release before parsing or applying a replacement graph. Another release pauses plugin updates and prompts for reload; dismissing the prompt never admits that release. The existing page and its state remain active.

Legacy graphs without release identity may reconcile with other legacy graphs. Either direction between absent and present identity requires reload. Source and partial builds may lack a commit; packaging requires the canonical full identity. Same-release graph revisions remain eligible for normal updates.

## Consequences

A release mismatch cannot hot-replace shared code beneath a running page. The user can defer reload while keeping the current page. Deferral does not migrate a session, delete settings, or update any application files. No account service, update server, or mandatory-update policy participates.
