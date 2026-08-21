/** Root inline Ink application. @module @deepseek-ai/dsh-tui/render/app */

import React from 'react'
import { Box, Text } from 'ink'
import type { ResumeRow } from '../driver/resume.ts'
import { selectCanSubmit } from '../state/selectors.ts'
import type { TuiStore } from '../state/store.ts'
import type { TuiInputDriver } from '../driver/input.ts'
import type { ProjectedTranscriptRow } from '../transcript/project.ts'
import type { ToolCardModel } from './tool-model.ts'
import { Composer } from './composer.tsx'
import { Overlays } from './overlays.tsx'
import { StatusLine } from './status.tsx'
import { Transcript } from './transcript.tsx'
import { useTuiStore } from './use-store.ts'

/** Properties for one root terminal application render. */
export interface TuiAppProps {
  readonly store: TuiStore
  readonly resumeRows?: readonly ResumeRow[]
  readonly getResumeRows?: () => readonly ResumeRow[]
  readonly input?: TuiInputDriver
  readonly projectTool?: (row: Extract<ProjectedTranscriptRow, { kind: 'tool-call' | 'tool-result' }>) => ToolCardModel
}

/**
 * Render the complete terminal shell from one immutable store snapshot.
 * @param props - application store and optional resume choices.
 * @returns the inline Ink element tree.
 */
export function TuiApp({ store, resumeRows = [], getResumeRows, input, projectTool }: TuiAppProps): React.JSX.Element {
  const state = useTuiStore(store)
  const compact = state.dimensions.columns < 48
  return <Box flexDirection="column" width={state.dimensions.columns}>
    <Text bold color="cyan">{compact ? 'dsh' : 'DeepSeek Harness · dsh'}</Text>
    <Transcript
      rows={state.finalizedRows} live={state.liveAssistant}
      {...state.projection === undefined ? {} : { projection: state.projection }}
      {...projectTool === undefined ? {} : { projectTool }}
    />
    <StatusLine status={state.status} compact={compact} />
    <Overlays overlay={state.overlay} interaction={state.interaction} resumeRows={getResumeRows?.() ?? resumeRows} />
    <Composer
      editor={state.editor} enabled={selectCanSubmit(state)} compact={compact}
      {...input === undefined ? {} : { input }}
      onInputError={(error) => { store.dispatch({ type: 'runtime/failed', message: error instanceof Error ? error.message : String(error) }) }}
    />
  </Box>
}
