/** One persisted Session record. Nested fields stay narrow at the readers below. */
interface SessionRecord {
  readonly type?: string
  readonly data?: SessionData
}

interface SessionData {
  readonly source?: { readonly kind?: string }
  readonly content?: readonly TextBlock[]
  readonly message?: {
    readonly content?: readonly TextBlock[]
    readonly isError?: boolean
    readonly toolCallId?: string
  }
  readonly callId?: string
  readonly name?: string
  readonly arguments?: string
}

interface TextBlock {
  readonly type?: string
  readonly text?: string
}

interface ToolOutcome {
  readonly index: number
  readonly name: string
  readonly arguments: string
  readonly text: string
  readonly isError: boolean
}

const SKILL_SEQUENCE = [
  'shared-skill',
  'home-only',
  'bundled-only',
  'agents-home-only',
  'shared-skill',
  'project-sibling',
] as const

/**
 * Require explicit skill loads across an unreadable project root and the root that returns after the symlink is removed.
 * A catalog is not treated as evidence that the isolated root published its skills.
 * @param log - persisted Session JSONL for one skill-root-isolation run.
 * @returns nothing when the parsed loads match the authored bodies and directories.
 */
export function assertSkillRootIsolation(log: string): void {
  const events = parseRecords(log)
  const outcomes = toolOutcomes(events)
  const skills = outcomes.filter(outcome => outcome.name === 'skill')
  const names = skills.map(skillName)
  if (names.join(',') !== SKILL_SEQUENCE.join(',')) {
    throw new Error(`wrong skill body: skill load order ${names.join(',')}`)
  }
  const removal = outcomes.find(outcome => outcome.name === 'bash'
    && outcome.arguments.includes('.dsh/skills/loop')
    && !outcome.isError)
  if (removal === undefined) throw new Error('missing skill-root symlink removal')
  if (events.some((event, index) => index < removal.index && event.data?.source?.kind === 'skill-catalog')) {
    throw new Error('skill catalog was published before the project root could be read')
  }
  const [first, home, bundled, agentsHome, recovered, sibling] = skills
  if (first === undefined || home === undefined || bundled === undefined || agentsHome === undefined
    || recovered === undefined || sibling === undefined) {
    throw new Error('wrong skill body')
  }
  assertBody(first, 'PROJECT_AGENTS_BODY', '/.agents/skills/shared-skill', 'PROJECT_DSH_BODY')
  if (first.index > removal.index) throw new Error('shared-skill did not resolve from project-agents')
  assertBody(home, 'HOME_ONLY_BODY', '/skill-user-home/')
  assertBody(bundled, 'BUNDLED_ONLY_BODY', '/skill-bundled/')
  assertBody(agentsHome, 'USER_AGENTS_BODY', '/skill-user-agents/')
  if (recovered.index < removal.index || sibling.index < removal.index) {
    throw new Error('project root was not isolated')
  }
  assertBody(recovered, 'PROJECT_DSH_BODY', '/.dsh/skills/shared-skill', 'PROJECT_AGENTS_BODY')
  assertBody(sibling, 'PROJECT_SIBLING_BODY', '/.dsh/skills/project-sibling')
}

function parseRecords(log: string): SessionRecord[] {
  return log.split('\n').flatMap((line) => {
    if (line.trim() === '') return []
    return [JSON.parse(line) as SessionRecord]
  })
}

function textOf(blocks: readonly TextBlock[] | undefined): string {
  return (blocks ?? []).flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : []).join('\n')
}

function toolOutcomes(events: readonly SessionRecord[]): ToolOutcome[] {
  const calls = new Map<string, { name: string; arguments: string }>()
  const outcomes: ToolOutcome[] = []
  for (const [index, event] of events.entries()) {
    if (event.type === 'tool/call' && event.data?.callId !== undefined && event.data.name !== undefined) {
      calls.set(event.data.callId, { name: event.data.name, arguments: event.data.arguments ?? '' })
    }
    if (event.type !== 'tool/result') continue
    const callId = event.data?.message?.toolCallId
    const call = callId === undefined ? undefined : calls.get(callId)
    if (call === undefined) continue
    outcomes.push({
      index,
      name: call.name,
      arguments: call.arguments,
      text: textOf(event.data?.message?.content),
      isError: event.data?.message?.isError === true,
    })
  }
  return outcomes
}

function skillName(outcome: ToolOutcome): string {
  const parsed = JSON.parse(outcome.arguments) as { readonly name?: string }
  return parsed.name ?? ''
}

function skillBody(text: string): string {
  const match = /<skill_instructions>\n([\s\S]*?)\n<\/skill_instructions>/u.exec(text)
  return match?.[1]?.trim() ?? ''
}

function assertBody(outcome: ToolOutcome, body: string, directory: string, absent?: string): void {
  if (outcome.isError || skillBody(outcome.text) !== body) throw new Error('wrong skill body')
  if (!outcome.text.includes(directory)) throw new Error(`skill ${body} did not load from ${directory}`)
  if (absent !== undefined && outcome.text.includes(absent)) throw new Error('wrong skill body')
}
