/** User-question batch panel. @module @deepseek-ai/dsh-tui/render/questions */

import { Box, Text } from 'ink'
import type { PendingInteraction } from '../state/types.ts'

type QuestionInteraction = Extract<PendingInteraction, { kind: 'question' }>

/** Properties for one visible question batch. */
export interface QuestionsPanelProps {
  readonly interaction: QuestionInteraction
}

/**
 * Render every question, offered option, description, and review detail.
 * @param props - immutable complete question request.
 * @returns one atomic question panel.
 */
export function QuestionsPanel({ interaction }: QuestionsPanelProps): React.JSX.Element {
  return <Box borderStyle="round" flexDirection="column">
    <Text bold>Questions</Text>
    {interaction.questions.map(question => <Box key={question.id} flexDirection="column">
      {question.header === undefined ? null : <Text bold>{question.header}</Text>}
      <Text>{question.question}</Text>
      {question.detail === undefined ? null : <Text>{question.detail}</Text>}
      {(question.options ?? []).map(option => <Text key={option.label}>
        ○ {option.label}{option.description === undefined ? '' : ` · ${option.description}`}
      </Text>)}
      <Text dimColor>{question.multiSelect === true ? 'Select one or more, or enter text' : 'Select one, or enter text'}</Text>
    </Box>)}
  </Box>
}
