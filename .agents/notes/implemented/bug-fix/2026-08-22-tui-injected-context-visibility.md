# Agent Note: The TUI transcript separates prompts from injected context

Status: implemented

English | [中文](2026-08-22-tui-injected-context-visibility.zh.md)

## Problem

The durable `user/message` event carries both direct human prompts and model-facing context, so its model-protocol role cannot identify human authorship. Rendering every append-origin event as `You` attributes workspace instructions, runtime policy snapshots, and the skill catalog to the user. Large instruction files then dominate the terminal even though the model request and session log are correct.

## Decision

The TUI projects a `user/message` into the human transcript only when `message.source.kind === 'user'`. Direct prompts and user-origin steering remain visible through live delivery and replay. Every other source remains durable and model-visible but contributes no terminal row.

This source classification refines the append-origin transcript decision in [the human transcript projection note](2026-07-29-human-transcript-append-origin.md). Append origin still distinguishes human history from model-only replacement copies; message source independently distinguishes human input from injected context inside that history.

The rule uses the merge-extensible source discriminator rather than producer names. A newly installed context producer is therefore hidden unless it explicitly emits a user-origin message, and the TUI does not need a dependency on each context package.

## Alternatives considered

**Render every `user/message` as `You`.** Rejected because the message role describes the model protocol, not human authorship; synthetic context uses the user role so providers give it the intended request weight.

**Render non-user sources under a `System` label.** Rejected because a different label still fills the terminal with model-facing envelopes and catalogs. The TUI has no disclosure control that could keep those bodies collapsed.

**Hide a fixed list of known producers.** Rejected because `MessageSourceMap` is merge-extensible. A producer list would expose every new context source until the terminal learned its name.

## Consequences

Terminal users see their own prompts, assistant output, reasoning, tools, commands, retries, and terminal status without injected context being attributed to them. Resume replay and live delivery use the same pure projection and therefore omit the same messages.

The model request, durable session data, telemetry, and other clients do not change. The Web client can continue to present injected context through its collapsed disclosure UI. The terminal gives up direct inspection of injected context; session logs and clients with a context disclosure remain the inspection paths.
