# 会话媒体

[English](media.md) | 中文

由 [`@deepseek-ai/dsh-experimental-desktop-media`](../../packages/experimental/desktop-media/README.zh.md) 拥有的会话媒体接缝。它编目留存的作品与音色、打开或显示已登记的作品、收受上传的字节,并通过用户自装的 FFmpeg 运行时产出付费视频与语音。Session Controller 通过其媒体 Remote 暴露它;没有 overlay 的 Host 返回 `session/media-unavailable`。

来源：[`packages/experimental/desktop-media/src/service.ts`](../../packages/experimental/desktop-media/src/service.ts)

## 持久事件

每个媒体事件都是 log-only：消费方通过该包的 Session 投影重建请求、批准、任务、作品与停止状态,而不是回放 payload。

- `media/request`
- `media/approval`
- `media/task`
- `media/artifact`
- `media/stop`

`media/*` 域属于本接缝。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdesktopmedia--desktopmedia"></a>

### `ctx.desktopMedia` — `DesktopMedia`

Overlay media service: catalogues, open/reveal, and paid producers.

```ts cordis-catalog
/**
 * Whether user FFmpeg is recorded and has the V1 encoders.
 * @param signal - caller lifetime.
 * @returns ready flag and install guidance.
 */
async runtimeStatus(signal: AbortSignal): Promise<MediaRuntimeStatus>

/**
 * List retained works without activating a session.
 * @param filter - optional workspace or session filter.
 * @returns catalogue rows.
 */
listWorks(filter: { workspaceId?: string; sessionId?: string } = {}): Promise<readonly MediaArtifactRecord[]>

/**
 * List system and cloned voices.
 * @returns catalogue rows.
 */
listVoices(): Promise<readonly MediaVoiceRecord[]>

/**
 * Open a registered work in the system default application.
 * @param artifactId - opaque catalogue id.
 * @param signal - caller lifetime.
 * @returns model-safe open wording.
 */
async openWork(artifactId: string, signal: AbortSignal): Promise<{ requested: true; message: string }>

/**
 * Reveal a registered work in the file manager.
 * @param artifactId - opaque catalogue id.
 * @param signal - caller lifetime.
 * @returns model-safe open wording.
 */
async revealWork(artifactId: string, signal: AbortSignal): Promise<{ requested: true; message: string }>

/**
 * Copyable absolute path for a registered work.
 * @param artifactId - opaque catalogue id.
 * @returns absolute path.
 */
async copyWorkPath(artifactId: string): Promise<{ path: string }>

/**
 * Copy a registered work into a user-chosen directory.
 * @param artifactId - opaque catalogue id.
 * @param destDir - absolute destination directory.
 * @param filename - basename only.
 * @returns written path.
 */
async saveWorkAs(artifactId: string, destDir: string, filename: string): Promise<{ path: string }>

/**
 * Admit selected bytes into managed storage.
 * @param request - filename and bytes.
 * @param sessionId - owning session.
 * @param workspaceId - optional workspace.
 * @returns committed artifact.
 */
async importBytes( request: ImportBytes, sessionId: string, workspaceId: string | undefined, ): Promise<MediaArtifactRecord>

/**
 * Start a paid video job after the caller has a live owner and approval.
 * @param owner - live agent.
 * @param args - validated generation args.
 * @param approval - hash-bound confirmation.
 * @returns durable request id and process-local job id.
 */
async createVideo( owner: Agent, args: CreateVideoArgs, approval: MediaApprovalInput, ): Promise<{ requestId: MediaRequestId; jobId: JobId }>

/**
 * Start a paid speech job.
 * @param owner - live agent.
 * @param text - narration copy.
 * @param voiceId - system or cloned voice.
 * @param approval - hash-bound confirmation.
 * @returns durable request id and job id.
 */
async createSpeech( owner: Agent, text: string, voiceId: string, approval: MediaApprovalInput, ): Promise<{ requestId: MediaRequestId; jobId: JobId }>

/**
 * Clone a voice from a registered import after consent.
 * @param owner - live agent.
 * @param artifactId - imported sample.
 * @param label - display name.
 * @param consent - speaker declaration.
 * @returns new local voice id.
 */
async cloneVoiceFromArtifact( owner: Agent, artifactId: string, label: string, consent: { speakerIsUser: boolean; authorized: boolean }, ): Promise<{ voiceId: MediaVoiceId }>

/**
 * Join approved clips and optional narration.
 * @param owner - live agent.
 * @param clipIds - artifact ids in join order.
 * @param narrationId - optional narration artifact.
 * @param mix - mix instead of replace.
 * @returns composed artifact.
 */
async compose( owner: Agent, clipIds: readonly string[], narrationId: string | undefined, mix: boolean, ): Promise<MediaArtifactRecord>

/**
 * Recover known provider tasks for a newly created live agent.
 * @param owner - live agent.
 * @returns started job ids.
 */
recover(owner: Agent): readonly JobId[]

/**
 * Estimate used when the provider does not return a charge.
 * @param kind - paid operation.
 * @returns yuan estimate.
 */
estimateYuan(kind: 'video' | 'speech' | 'clone'): number
```

Types: [Agent](core.zh.md) · [JobId](jobs.zh.md)

Source: [`packages/experimental/desktop-media/src/service.ts`](../../packages/experimental/desktop-media/src/service.ts)
<!-- END GENERATED cordis-surface -->
