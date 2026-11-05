/** Host-backed work-details presentation policy. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  COLLAPSE_TIMING_FIELD, DEFAULT_COLLAPSE_TIMING, DEFAULT_FOLDED_REPLIES, FOLDED_REPLIES_FIELD,
  type CollapseTiming, type FoldedReplies,
  DEFAULT_TRANSCRIPT_VIEW_MODE, LEGACY_TRANSCRIPT_VIEW_MODE, LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE, TRANSCRIPT_VIEW_FIELD,
  type ChatSettings, type TranscriptViewMode,
} from '../chat-settings.ts'

/** Live work-details preference consumed by Chat and its Settings row. */
export class TranscriptViewPolicy {
  private readonly unsubscribe: () => void
  /** Reactive current mode, including the client default before Host settings arrive. */
  readonly mode: SnapshotStore<TranscriptViewMode>
  /** Current independent collapse timing. */
  readonly collapseTiming = createSnapshotStore<CollapseTiming>(DEFAULT_COLLAPSE_TIMING)
  /** Current folded reply preference. */
  readonly foldedReplies = createSnapshotStore<FoldedReplies>(DEFAULT_FOLDED_REPLIES)

  /**
   * @param host - durable Chat settings scope.
   * @param defaultMode - presentation used without an explicit saved mode.
   */
  constructor(
    private readonly host: ConfigForm<ChatSettings>,
    private readonly defaultMode: TranscriptViewMode = DEFAULT_TRANSCRIPT_VIEW_MODE,
  ) {
    this.mode = createSnapshotStore(defaultMode)
    this.unsubscribe = host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /** Release the accepted-value subscription. */
  dispose(): void { this.unsubscribe() }

  /**
   * Publish and persist one explicit user choice.
   * @param mode - Compact, Standard, Detailed, or Verbose work details.
   */
  setMode(mode: TranscriptViewMode): void {
    if (this.mode.getSnapshot() === mode) return
    this.mode.set(mode)
    void this.host.set(TRANSCRIPT_VIEW_FIELD, mode)
  }

  /**
   * Publish and persist collapse timing without changing the work-details mode.
   * @param timing - immediate completion folding or deferred folding at the next input.
   */
  setCollapseTiming(timing: CollapseTiming): void {
    if (this.collapseTiming.getSnapshot() === timing) return
    this.collapseTiming.set(timing)
    void this.host.set(COLLAPSE_TIMING_FIELD, timing)
  }

  /**
   * Publish and persist which Assistant replies stay visible in a folded Turn.
   * @param replies - every reply, or only the final answer.
   */
  setFoldedReplies(replies: FoldedReplies): void {
    if (this.foldedReplies.getSnapshot() === replies) return
    this.foldedReplies.set(replies)
    void this.host.set(FOLDED_REPLIES_FIELD, replies)
  }

  /** Adopt the latest accepted Host section without writing it back. */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined) return
    const saved = section.transcriptView
    const mode = saved === LEGACY_TRANSCRIPT_VIEW_MODE || saved === LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE
      ? 'detailed' : saved ?? this.defaultMode
    if (this.mode.getSnapshot() !== mode) this.mode.set(mode)
    this.collapseTiming.set(section.collapseTiming ?? DEFAULT_COLLAPSE_TIMING)
    this.foldedReplies.set(section.foldedReplies ?? DEFAULT_FOLDED_REPLIES)
  }
}
