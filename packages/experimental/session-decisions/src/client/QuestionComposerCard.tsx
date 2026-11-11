/** Active question answer surface in the full-width area above the ordinary composer. */
import { useEffect, useRef } from 'react'
import { QuestionCard, type QuestionCardProps } from './QuestionCard.tsx'

/**
 * Render the active Session question without a header-popover prerequisite.
 * @param props - Session identity, shared question source and locale hooks.
 * @returns The active answer form, or nothing when no question awaits an answer.
 */
export function QuestionComposerCard(props: Pick<QuestionCardProps, 'sessionId' | 'source' | 'useRefresh' | 'useSession' | 't'>) {
  const running = props.useSession(session => session.running)
  const wasRunning = useRef(running)
  useEffect(() => {
    const stopped = wasRunning.current && !running
    wasRunning.current = running
    if (stopped) props.source.refresh()
  }, [running, props.source])
  return <QuestionCard {...props} inline />
}
