/** Snapshot-only interaction producer loaded through the real example Loader tree. */

import type { Context } from '@deepseek-ai/cordis'
import { writeFile } from 'node:fs/promises'
import type {} from '@deepseek-ai/dsh-tui'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'

/** Cordis plugin name. */
export const name = 'tui-interaction-fixture'

/** Services exercised by the fixture. */
export const inject = ['approval', 'userQuestions']

/** Publish a question followed by a turn-enclosed approval after the TUI owns its Agent. */
export function apply(ctx: Context): void {
  ctx.on('tui/controller-mounted', ({ agent }) => {
    if (agent === undefined) throw new Error('tui interaction fixture needs a live Agent')
    void ctx.userQuestions.ask({
      agent,
      questions: [
        { id: 'target', header: 'Target', question: 'Choose target', options: [{ label: 'Code' }, { label: 'Docs' }] },
        { id: 'notes', header: 'Notes', question: 'Add release notes' },
      ],
    }).then(async () => {
      agent.session.append('turn/start', { turn: 1 })
      await ctx.approval.request({ agent, toolName: 'fixture-tool', reason: 'verify the terminal approval key' })
      agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      await writeFile('.tui-interactions-complete', '')
    }).catch((error: unknown) => {
      process.stderr.write(`tui interaction fixture: ${error instanceof Error ? error.message : String(error)}\n`)
    })
  })
}
