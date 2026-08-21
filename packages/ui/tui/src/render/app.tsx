/** Root inline Ink application. @module @deepseek-ai/dsh-tui/render/app */

import { Box, Text } from 'ink'
import type { ResumeRow } from '../driver/resume.ts'
import { selectCanSubmit } from '../state/selectors.ts'
import type { TuiStore } from '../state/store.ts'
import { Composer } from './composer.tsx'
import { Overlays } from './overlays.tsx'
import { StatusLine } from './status.tsx'
import { Transcript } from './transcript.tsx'
import { useTuiStore } from './use-store.ts'

/** Properties for one root terminal application render. */
export interface TuiAppProps {
  readonly store: TuiStore
  readonly resumeRows?: readonly ResumeRow[]
}

/**
 * Render the complete terminal shell from one immutable store snapshot.
 * @param props - application store and optional resume choices.
 * @returns the inline Ink element tree.
 */
export function TuiApp({ store, resumeRows = [] }: TuiAppProps): React.JSX.Element {
  const state = useTuiStore(store)
  const compact = state.dimensions.columns < 48
  return <Box flexDirection="column" width={state.dimensions.columns}>
    <Text bold color="cyan">{compact ? 'dsh' : 'DeepSeek Harness · dsh'}</Text>
    <Transcript rows={state.finalizedRows} live={state.liveAssistant} />
    <StatusLine status={state.status} compact={compact} />
    <Overlays overlay={state.overlay} interaction={state.interaction} resumeRows={resumeRows} />
    <Composer editor={state.editor} enabled={selectCanSubmit(state)} compact={compact} />
  </Box>
}
