import type { ReactNode } from 'react'
import { IconSparkleRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the sparkle icon for the persistent assistants sidebar entry.
 * @param props - sidebar icon sizing and selection state.
 * @returns rendered icon element.
 */
export function AssistantsPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconSparkleRegular size={size} />
}
