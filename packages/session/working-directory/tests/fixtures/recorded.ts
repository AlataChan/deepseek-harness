/** Deterministic keyless model chunks replayed by the actual Agent driver. */
import { textResponse, toolCallResponse } from '../../../../core/agent-loop/tests/mock-adapter.ts'
/** @returns one directory change followed by its acknowledgement. */
export function directoryScript() {
  return [toolCallResponse('recorded-directory', 'working_directory', { cd: 'selected' }), textResponse('Directory selected.')]
}
