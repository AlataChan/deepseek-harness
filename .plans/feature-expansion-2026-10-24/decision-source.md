# Message Source Decision Record (Phase 0)

## 1. Context & Problem Statement

In expanding DeepSeek Harness for IM (specifically Feishu enterprise self-built applications) and multi-tenant OS isolation, external text messages from authenticated operators must enter the Agent Loop and durable Session logs.

Previous drafts proposed adding a new committed source variant (`kind: 'im'`). Revision v4 of the architecture plan withdrew this assumption and established Phase 0 executable fixtures to evaluate three candidate options:
- **Option (a)**: `source.kind: 'im'`, carrying delivery identity directly in Session source (`{ kind: 'im', deliveryId: '...' }`).
- **Option (b)**: `source.kind: 'user'`, with an added `deliveryId` field in Session source (`{ kind: 'user', deliveryId: '...' }`).
- **Option (c)**: `source.kind: 'user'`, with a newly minted `SessionRequestId` (random UUID v4) in existing `rpcId` (`{ kind: 'user', rpcId: '...' }`), while all external delivery metadata is persisted in the domain database (`storage-domain` / SQLite).

This decision record documents the empirical evidence from public format catalog readers, migrations, human-turn behavior consumers, and production owner integration tests.

---

## 2. Public Format Catalog & Migration Evidence

Executable test evidence is recorded in [`packages/experimental/im-feishu/tests/fixtures.spec.ts`](../../packages/experimental/im-feishu/tests/fixtures.spec.ts), which uses the public format catalog reader (`catalog.createRestore`) across generations 0 to 4:

| Format Version | Option (a): `kind: 'im'` | Option (b): `kind: 'user'` + `deliveryId` | Option (c): `kind: 'user'` + `rpcId` (UUID v4) |
|---|---|---|---|
| **Version 0** | **Refused**: `cannot safely transform unclassified message source` during v0 $\to$ v1 migration. | **Refused**: `user/message 2 source has unexpected member "deliveryId"` during v0 validation. | **Accepted**: Passes restore cleanly. |
| **Version 1** | **Refused**: `cannot safely transform unclassified message source` during v1 $\to$ v2 migration. | **Refused**: `user/message 2 source has unexpected member "deliveryId"` during v1 validation. | **Accepted**: Passes restore cleanly. |
| **Version 2** | **Refused**: `cannot safely transform unclassified message source` during v2 $\to$ v3 migration. | **Refused**: `user/message 2 source has unexpected member "deliveryId"` during v2 validation. | **Accepted**: Passes restore cleanly. |
| **Version 3** | **Accepted**: V3 $\to$ V4 migration passes unclassified kinds through as direct producer kinds. | **Accepted**: V3 $\to$ V4 migration accepts `kind: 'user'` with unclassified extra fields. | **Accepted**: Passes restore cleanly. |
| **Version 4** (Current) | **Accepted**: Current V4 parser admits non-plugin kinds. | **Accepted**: Current V4 parser admits extra non-whitelisted user fields dynamically. | **Accepted**: Passes restore cleanly without schema modification. |

### Key Findings:
1. **Catalog Reader vs Format Bumps**:
   - In historical generations 0 to 2, the format migration chain strictly rejects Option (a) (`cannot safely transform unclassified message source`) and Option (b) (`unexpected member "deliveryId"`).
   - In generations 3 and 4 (current format), the catalog reader accepts Option (a), Option (b), and Option (c).
   - In current formats (generations 3 and 4), Option (b) does *not* strictly require a format bump or catalog edit to be decoded by current-format session readers. However, Option (c) is strongly preferred for domain separation and human semantics, not because it is the "only format-admissible" option for current sessions.
2. **Title Citation Relationships**:
   - `packages/session/session-format-v3-to-v4/src/relationships.ts:360` enforces `record(source.data, 'title input source')['kind'] === 'user'`.
   - Citing an Option (a) (`kind: 'im'`) message in a `session/title` event throws `SessionFormatError: session/title messageSeqs must cite distinct earlier human user/message events`.

---

## 3. Production `source.kind === 'user'` Static Inventory & Verification Scope

A static inventory of production code across `packages/` (excluding tests, docs, and generated bundles) revealed **35 textual occurrences across 24 files** that check `source.kind === 'user'`:

### Production Call Site Inventory

1. **`packages/session/session-title/src/index.ts:444, 503`**: Session title generation and user-title preservation; checks `source.kind === 'user'`.
2. **`packages/session/session-format-v3-to-v4/src/relationships.ts:353, 360`**: Cross-event relationship validation; enforces title citations reference `source.kind === 'user'`.
3. **`packages/skill/tool-skill/src/index.ts:171, 421`**: Explicit skill slash-command scanning; ignores non-human messages.
4. **`packages/goal/tool-goal/src/authority.ts:83`**: Goal authority checks (`requireDirectHuman`); enforces `source.kind === 'user'`.
5. **`packages/context/time-context/src/request-zone.ts:17`**: Client browser time zone derivation; checks `source.kind === 'user' && 'rpcId' in source && 'clientTimeZone' in source`.
6. **`packages/guard/repeat-tool-reminder/src/index.ts:237`**: Repetitive tool loop breaker; resets tool repetition counter on human interjection (`m.source.kind === 'user'`).
7. **`packages/jobs/tool-jobs/src/index.ts:215`**: Wake budget replenishment; resets spent wake limits on human prompt claim.
8. **`packages/api/session-controller/src/list.ts:52`**: Session list metadata; updates `lastPromptAt` timestamp only on `event.data.source.kind === 'user'`.
9. **`packages/session/session-turn-outline/src/projection.ts:110`**: Turn outline projection; extracts opening human prompt preview text only if `event.data.source.kind === 'user'`.
10. **`packages/context/session-reference/src/projection.ts:44` & `src/index.ts:159`**: Cross-session referencing; extracts human conversation turns, skipping non-user messages.
11. **`packages/experimental/auto-review/src/index.ts:179, 217`**: Auto-review risk appraisal; human instructions establish root audit scope.
12. **`packages/experimental/agent-team/src/roster.ts:410`**: Agent team initial prompt acceptance; checks `message.source.kind === 'user'`.
13. **`packages/experimental/claude-code-mods/src/index.ts:85`**: Filters claimed human messages.
14. **`packages/experimental/assistant-registry/src/prediction-context.ts:72, 73, 105, 162` & `index.ts:4534, 4538`**: Goal and latest human prompt extraction for assistant prompt prediction.
15. **`packages/web/web-deepseek-api/src/index.ts:61`**: Extracts latest human prompt for web search context (`message.source.kind === 'user'`).
16. **`packages/api/session-controller/src/commands.ts:490, 605, 612`**: Queue removal, prompt deduplication, and file upload retirement matching `source.kind === 'user' && 'rpcId' in source`.
17. **`packages/client/ui-chat/src/client/conversation-nodes/inbox.ts:94` & `turn-process-presentation.ts:44, 56`**: Identifies human-claimed turns in the client UI.
18. **`packages/client/ui-chat/src/client/chat/ChatView.tsx:180, 218`**: Steering and pending input identification in chat rendering.
19. **`packages/client/ui-conversation/src/client/queue/QueueDock.tsx:121`**: Extracts `rpcId` for queue item tracking.

### Verification Status: Direct Tests vs. Static Analysis

| Verification Mode | Covered Sites | Status |
|---|---|---|
| **Direct Executable Unit Tests** ([`packages/experimental/im-feishu/tests/human-behavior.spec.ts`](../../packages/experimental/im-feishu/tests/human-behavior.spec.ts)) | 1. `deriveBrowserTimeZoneContext` (time context resolution)<br>2. `applySessionListMetadata` (`lastPromptAt` timestamp update)<br>3. `turnOutlineProjectionDefinition` (turn prompt preview extraction) | **VERIFIED**: Option (c) passes production implementations; Option (a) fails to resolve time zone, misses `lastPromptAt`, and yields empty prompt preview. |
| **Direct Executable Owner Integration Tests** ([`packages/experimental/im-feishu/tests/namespace-isolation.host.spec.ts`](../../packages/experimental/im-feishu/tests/namespace-isolation.host.spec.ts) and [`packages/experimental/im-feishu/tests/namespace-isolation.client.spec.ts`](../../packages/experimental/im-feishu/tests/namespace-isolation.client.spec.ts)) | 4. `SessionCommandController` duplicate prompt admission (`hasPromptRequest`)<br>5. `FileUploads` staged browser upload retirement isolation (`observeSessionEvent` / `retire`)<br>6. Client `Session` submission settlement isolation (`beginSubmission` / `onRetire`) | **VERIFIED**: Option (c) minted `SessionRequestId` correctly deduplicates duplicate prompt deliveries on the Host, does not retire distinct staged browser uploads, and does not settle pending browser submissions in the Client. Matching browser control deliveries retire and settle as expected. |
| **Static Code Inspection Only** | 7. Explicit skill slash-command scanning (`tool-skill`)<br>8. Goal human authority (`tool-goal`)<br>9. Repeat-tool loop breaker reset (`repeat-tool-reminder`)<br>10. Background job wake replenishment (`tool-jobs`)<br>11. Web prompt extraction (`web-deepseek-api`)<br>12. Assistant registry prediction context (`assistant-registry`)<br>13. Agent team prompt acceptance (`agent-team`) | **ANALYZED STATICALLY**: Code inspected; behavior confirmed consistent with `source.kind === 'user'`, but not exercised by unit tests. |
| **Deferred / Not Run** | 14. Live Feishu webhook network ingress<br>15. OS tenant isolation (`systemd-run` / Linux UID boundaries) | **NOT RUN IN PHASE 0**: Strictly deferred to later phases. |

---

## 4. Namespace Ownership & Downstream Isolation

### Namespace Declaration
`SessionRequestId` is declared in `@deepseek-ai/dsh-api-session-controller/types`:
```ts
export type SessionRequestId = Branded<'session-request-id'>

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Authenticated client or ingress prompt correlation and optional Host-validated time zone. */
    'user-rpc': { kind: 'user'; rpcId: SessionRequestId; clientTimeZone?: string }
  }
}
```

### Downstream Isolation Analysis:
1. **Independent UUID v4 Minting**:
   - `mintImSessionRequestId()` generates RFC 4122 random UUID v4 strings branded as `SessionRequestId`.
   - Independent UUID v4 minting reduces collision risk across tenants; database persistence and retry mapping are deferred to future phases.
2. **Separation of Transport from Session Vocabulary**:
   - External Feishu identifiers (`appId`, `tenantId`, `chatId`, `senderId`, `eventId`) belong to the IM ingress transport layer and domain storage.
   - Option (c) ensures that no transport-layer routing artifacts pollute the core `SessionEvent` stream, keeping session logs clean and portable across interfaces.
3. **Owner Integration Verification**:
   - **Host Prompt Deduplication**: Verified in [`../../packages/experimental/im-feishu/tests/namespace-isolation.host.spec.ts`](../../packages/experimental/im-feishu/tests/namespace-isolation.host.spec.ts). Submitting the same minted `SessionRequestId` twice to `SessionCommandController.prompt` yields 1 admitted turn in `inbox.nextTurn`; a distinct minted ID admits a second turn.
   - **Host Staged Upload Isolation**: Verified in [`../../packages/experimental/im-feishu/tests/namespace-isolation.host.spec.ts`](../../packages/experimental/im-feishu/tests/namespace-isolation.host.spec.ts). Appending an IM message with a minted ID does not retire staged browser file uploads in `FileUploads`. Appending a matching browser request ID retires the staged upload.
   - **Client Settlement Isolation**: Verified in [`../../packages/experimental/im-feishu/tests/namespace-isolation.client.spec.ts`](../../packages/experimental/im-feishu/tests/namespace-isolation.client.spec.ts). Appending an IM message with a minted ID leaves pending browser submissions in `Session.getSnapshot().pendingSubmissions` intact and unretired. Appending a matching browser request ID settles and retires the submission with `{ reason: 'observed', attachments: [] }`.
