# Agent Note: Direct DeepSeek Search and Fetch APIs

Status: implemented

English | [中文](2026-10-15-deepseek-search-fetch-api.zh.md)

## Problem

Messages-based search requires an auxiliary model generation, while direct retrieval needs separate endpoint, credential, and question-forwarding controls.

## Alternatives considered

**Replace Messages search by default.** Retaining the existing default avoids changing network behavior without consent; direct Search and Fetch remain opt-in.

**Include account routing.** Account integration is outside this selective upgrade; refusing that route keeps the API-key path independent.

## Decision

The [web-deepseek-api plugin](../../../../packages/web/web-deepseek-api/README.md) registers direct Search and Fetch providers. Messages search remains independent and is the default, alongside local HTTP fetch. The settings switch selects both direct providers after saving; each operation reads the current selection.

Direct retrieval requires an API key. Account-routed requests are refused before dispatch, and the package neither imports nor resolves account credentials. Each operation snapshots its configured endpoint and credential reference together. Redirects of authenticated API requests are rejected.

Sending the triggering human question is a separate opt-in, disabled by default. When enabled, the latest human prompt is whitespace-normalized and bounded to 128 Unicode characters. Direct retrieval emits ordinary tool-call and result events; it does not fabricate auxiliary model events.

The API and Messages transports deliberately remain independent. Shared credential and cancellation logic would otherwise couple their releases. Local duplication markers identify the repeated helpers.

## Consequences

Direct Search avoids the auxiliary Messages generation, but retrieved sources still consume the main model context. Direct Fetch delegates target retrieval policy to DeepSeek; its successful HTTP 200 describes the service response, not an independently observed target response. Local HTTP fetch retains its own network checks.

The retained Messages path disables thinking and records the exact dispatch body. The [persistence acknowledgement](../../../../docs/persistence-changes/2026-10-13-deepseek-search-thinking.md) describes the optional logged member.

## Verification

Provider controls cover credential rotation, explicit account refusal, default question omission, opt-in forwarding, malformed responses, cancellation, proxy egress, and redirect refusal. Settings controls cover staging, save failures, selection switching, and forwarding consent. The Fetch Session fixture and Web search browser scenario own recorded product output.
