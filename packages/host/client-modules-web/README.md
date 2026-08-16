# `@deepseek-ai/dsh-host-client-modules-web`

English | [中文](README.zh.md)

Web transport adapter for [`@deepseek-ai/dsh-client-modules`](../../client/modules/README.md). It serves the registry's discovered Client Plugin bundles and adjacent source maps under `/plugins/<id>/client.js`. Before the browser shell bundle runs, its index tap installs the registration queue, parser-preloads the module-system and Client runtime bundles, then publishes the current `ClientBootGraph` as `window.__DSH_BOOT__`. The module registry itself owns discovery, bundle paths, hashing, graph composition, and rebuild notifications without requiring a Web server; this package owns only the Web route and index tap.

Both registrations are effect-scoped. Disposing this plugin releases the `/plugins` route and removes its index transform without stopping the registry.

## Model Experience

None, as the adapter serves browser assets and boot metadata; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The route namespace is fixed** — Web compositions reserve `/plugins` for Client Plugin bundles and the HMR event endpoint; alternate transports consume the registry directly instead of configuring this adapter.
