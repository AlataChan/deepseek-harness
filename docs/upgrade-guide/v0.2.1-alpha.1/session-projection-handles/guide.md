---
kind: upgrade-guide
description: "Projection owners await registration and retain their own read handles."
---

# Retain projection registration handles

English | [中文](guide.zh.md)

## Change

`sessionProjections.register(definition)` asynchronously initializes one projection and returns its `ProjectionHandle`. The owner retains that handle and reads through `stateOf(session)` or `readerFor(session)`. A reader stays tied to its original registration after replacement; it never silently reads a new owner. Initialization failure rejects registration. Await the owner before exposing consumers.

The legacy key lookup returns `unknown` and warns once per key. The registration result is a callable thenable for synchronous cleanup compatibility, rather than a native Promise. An asynchronous Cordis plugin or effect must await registration and return void; returning the resolved handle is not a valid effect disposer.

The subagent policy helpers `subagentModelSelectionPolicy` and `recordSubagentModelSelection` now accept the retained policy handle's `stateOf` reader, instead of the registry's keyed lookup. Keep that handle private to the tool composition. `agentPresets.presetOf(session)` supplies the logged preset choice, including blank-session selections, to other domains.

The desktop-media helper `optionalHostSeam(ctx, name)` returns `unknown` and accepts no type argument. Narrow or assert the known service at its typed consumer; the helper performs only service lookup and does not validate the selected service's methods.

## Migration

1. Await registration in the owning plugin and store the resulting handle. Expose domain methods to consumers instead of exporting the handle or re-registering the same key.
2. Replace synchronous key reads with the owner's retained handle or domain methods. Preserve missing-state and failed-state refusals; do not substitute empty state.
3. Dispose the handle with its owner and await asynchronous teardown. Retained readers do not transfer cleanup ownership.
4. Test initialization rejection, concurrent preparation, replacement, owner disposal, and cold restore from old projection caches. Session logs are unchanged by the registration API.

See the [projection reference](../../../../packages/session/session-projection/README.md) for legacy synchronous cleanup compatibility.
