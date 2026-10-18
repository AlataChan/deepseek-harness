/** Real process ownership with a deterministic Codex protocol peer. */
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { fileURLToPath } from 'node:url'

/** Rewrite only the fixed Codex app-server command; retain production stdio and teardown. */
export default class SnapshotCodexSubprocess extends LocalSubprocessRuntime {
  spawn(spec) {
    const [node, wrapper, command, stdio] = spec.argv
    if (node !== process.execPath || typeof wrapper !== 'string'
      || !wrapper.replaceAll('\\', '/').endsWith('/@openai/codex/bin/codex.js')
      || command !== 'app-server' || stdio !== '--stdio' || spec.argv.length !== 4) {
      throw new Error('codex-partial-answer: unexpected subprocess command')
    }
    return super.spawn({
      ...spec,
      argv: [process.execPath, fileURLToPath(new URL('./app-server-fixture.mjs', import.meta.url))],
    })
  }
}
