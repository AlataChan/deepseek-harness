/** Browser entry for Persistent Assistants UI. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import assistantsRemote from '@deepseek-ai/dsh-experimental-assistant-registry/remote'
import { mountAssistantsUi } from './mount.ts'

export { inject, registerUi, mountAssistantsUi, PANEL_ID } from './mount.ts'
export type {
  AssistantClientOps,
  CreateTeamFromTemplateOptions,
  TeamFromTemplateResult,
  TeamTemplateId,
} from './mount.ts'
export type { AssistantModelOption } from './models.ts'
export { AssistantDirectory } from './AssistantDirectory.tsx'
export type { AssistantDirectoryProps, AssistantDirectoryInjected } from './AssistantDirectory.tsx'
export { AssistantHeroCard } from './AssistantHeroCard.tsx'
export type { AssistantHeroCardProps, AssistantHeroCardInjected } from './AssistantHeroCard.tsx'
export { AssistantConversationHeader } from './AssistantConversationHeader.tsx'
export type { AssistantConversationHeaderProps, AssistantConversationHeaderInjected } from './AssistantConversationHeader.tsx'
export { AssistantDetailDrawer } from './AssistantDetailDrawer.tsx'
export type { AssistantDetailDrawerProps } from './AssistantDetailDrawer.tsx'
export { AssistantExampleChips } from './AssistantExampleChips.tsx'
export type { AssistantExampleChipsProps, AssistantExampleChipsInjected } from './AssistantExampleChips.tsx'
export { AssistantsPanelIcon } from './AssistantsPanelIcon.tsx'
export { TeamCreationModal } from './TeamCreationModal.tsx'
export type { TeamCreationModalProps, CreateTeamPayload } from './TeamCreationModal.tsx'
export { TeamEditorModal } from './TeamEditorModal.tsx'
export type { TeamEditorModalProps, SaveTeamUpdatesPayload, SeatUpdateItem, TeamSeatUpdatePatch } from './TeamEditorModal.tsx'
export { TeamView } from './TeamView.tsx'
export type { TeamViewProps, TeamViewTab } from './TeamView.tsx'
export { MemoryPanel } from './MemoryPanel.tsx'
export type { MemoryPanelProps } from './MemoryPanel.tsx'
export { ComposerPrediction, AssistantPredictionDock } from './ComposerPrediction.tsx'
export type {
  ComposerPredictionProps,
  ComposerPredictionData,
  AssistantPredictionDockProps,
  AssistantPredictionDockInjected,
} from './ComposerPrediction.tsx'
export { PredictionSettingRow, PredictionSettingToast } from './PredictionSettingRow.tsx'
export type { PredictionSettingInjected } from './PredictionSettingRow.tsx'
export { PredictionSettingPreference } from './prediction-preference.ts'
export type { PredictionSettings, PredictionMutation } from './prediction-preference.ts'
export { NS, zh, en } from './locales.ts'
export type { AssistantLocaleKey } from './locales.ts'

/**
 * Browser plugin entry applying assistant UI slot registrations.
 * @param ctx - browser client context.
 * @returns cleanup disposer.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  return await mountAssistantsUi(ctx, assistantsRemote)
}
