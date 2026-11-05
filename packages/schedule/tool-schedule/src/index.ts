/**
 * Model-facing `schedule_create`, `schedule_list`, `schedule_edit`, and
 * `schedule_view` tools over the Host `ctx.schedule` service. Mounting the
 * plugin registers them in the mounting scope, so a preset decides which
 * agents receive them; calls record the actual acting Session without granting human input authority.
 * @module @deepseek-ai/dsh-tool-schedule
 */

import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { delegationDepthOf } from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { MAX_TITLE_LENGTH, MIN_EVERY_INTERVAL_SECONDS, ScheduleId, ScheduleInputError } from '@deepseek-ai/dsh-schedule'
import type { InternalScheduleError, ScheduleToolError, ScheduleTargetRequest } from '@deepseek-ai/dsh-schedule'

/** Plugin name registered with the Loader. */
export const name = 'tool-schedule'

/** Host services this plugin consumes. The Schedule service is resolved per
 * scope, so a preset that declares this plugin stays inert while the shipped
 * composition keeps that service off. */
export const inject = ['tools']

const CREATE_SPEC_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  cwd: { type: 'string' }, agentPreset: { type: 'string' },
} } as const
const SESSION_TARGET_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  kind: { type: 'string', required: true, const: 'session' }, sessionId: { type: 'string', required: true },
} } as const
const TARGET_REQUEST_SCHEMA = { oneOf: [SESSION_TARGET_SCHEMA,
  { type: 'object', additionalProperties: false, properties: {
    kind: { type: 'string', const: 'new_once', required: true }, create: CREATE_SPEC_SCHEMA,
  } },
  { type: 'object', additionalProperties: false, properties: {
    kind: { type: 'string', const: 'new', required: true }, create: CREATE_SPEC_SCHEMA,
  } },
] } as const
const TARGET_SCHEMA = { oneOf: [SESSION_TARGET_SCHEMA,
  { type: 'object', additionalProperties: false, properties: {
    kind: { type: 'string', const: 'new_once', required: true }, sessionId: { type: 'string', required: true },
    create: { ...CREATE_SPEC_SCHEMA, required: true },
  } },
  { type: 'object', additionalProperties: false, properties: {
    kind: { type: 'string', const: 'new', required: true }, create: { ...CREATE_SPEC_SCHEMA, required: true },
  } },
] } as const

const SHARED_VIEW_PROPERTIES = {
  id: { type: 'string', required: true },
  title: { type: 'string', required: true },
  prompt: { type: 'string', required: true },
  scheduledAt: { type: 'string', required: true },
  target: { ...TARGET_SCHEMA, required: true },
  involvedSessionIds: { type: 'array', items: { type: 'string' }, required: true },
  status: { type: 'string', required: true, enum: ['active', 'paused', 'ended'] },
  createdAt: { type: 'string' }, updatedAt: { type: 'string' },
  executionActive: { type: 'boolean', const: true }, deliveryFloorEndsAt: { type: 'string' },
  lastDelivery: { type: 'object', additionalProperties: false, properties: {
    scheduledAt: { type: 'string', required: true }, deliveredAt: { type: 'string', required: true },
    messageId: { type: 'string', required: true }, targetSessionId: { type: 'string', required: true },
  } },
} as const

const AFTER_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...SHARED_VIEW_PROPERTIES,
    kind: { type: 'string', required: true, const: 'after' },
    afterSeconds: { type: 'integer', required: true },
  },
} as const

const AT_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...SHARED_VIEW_PROPERTIES,
    kind: { type: 'string', required: true, const: 'at' },
  },
} as const

const EVERY_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...SHARED_VIEW_PROPERTIES,
    kind: { type: 'string', required: true, const: 'every' },
    everySeconds: { type: 'integer', required: true },
  },
} as const

const DAILY_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...SHARED_VIEW_PROPERTIES,
    kind: { type: 'string', required: true, const: 'daily' },
    time: { type: 'string', required: true },
    timeZone: { type: 'string', required: true },
  },
} as const

const WEEKLY_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...SHARED_VIEW_PROPERTIES,
    kind: { type: 'string', required: true, const: 'weekly' },
    time: { type: 'string', required: true },
    timeZone: { type: 'string', required: true },
    weekdays: { type: 'array', required: true, items: { type: 'integer' } },
  },
} as const

const CRON_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...SHARED_VIEW_PROPERTIES,
    kind: { type: 'string', required: true, const: 'cron' },
    expression: { type: 'string', required: true },
    timeZone: { type: 'string', required: true },
  },
} as const

const VIEW_SCHEMA = {
  oneOf: [
    AFTER_VIEW_SCHEMA, AT_VIEW_SCHEMA, EVERY_VIEW_SCHEMA, DAILY_VIEW_SCHEMA, WEEKLY_VIEW_SCHEMA, CRON_VIEW_SCHEMA,
  ],
} as const

/** Build one exact two-field error schema while preserving its literal code. */
function basicErrorSchema<const C extends string>(code: C) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      code: { type: 'string', required: true, const: code },
      message: { type: 'string', required: true },
    },
  } as const
}

const ERROR_SCHEMAS = [
  basicErrorSchema('invalid_prompt'),
  basicErrorSchema('invalid_selector'),
  basicErrorSchema('invalid_rule'),
  basicErrorSchema('invalid_time_zone'),
  basicErrorSchema('not_future'),
  basicErrorSchema('time_out_of_range'),
  basicErrorSchema('frequency_too_high'),
  basicErrorSchema('subagent_session'),
  basicErrorSchema('internal_error'),
] as const

const PAGE_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  items: { type: 'array', items: VIEW_SCHEMA, required: true },
  shown: { type: 'integer', required: true }, total: { type: 'integer', required: true },
  limit: { type: 'integer', required: true }, offset: { type: 'integer', required: true },
} } as const
const MISS_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  id: { type: 'string', required: true }, code: { type: 'string', required: true, enum: ['schedule_not_found', 'schedule_conflict'] },
} } as const
const DELETED_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  id: { type: 'string', required: true }, deleted: { type: 'boolean', const: true, required: true },
} } as const
const CREATE_OUTPUT_SCHEMA = { oneOf: [VIEW_SCHEMA, ...ERROR_SCHEMAS] } as const
const LIST_OUTPUT_SCHEMA = { oneOf: [PAGE_SCHEMA, ...ERROR_SCHEMAS] } as const
const VIEW_OUTPUT_SCHEMA = { oneOf: [VIEW_SCHEMA, MISS_SCHEMA, ...ERROR_SCHEMAS] } as const
const EDIT_OUTPUT_SCHEMA = { oneOf: [VIEW_SCHEMA, MISS_SCHEMA, DELETED_SCHEMA, ...ERROR_SCHEMAS] } as const

const MANAGEMENT_AUTHORIZATION = 'Create or modify tasks only at the user\'s explicit request; prior explicit authorization for a running task remains valid.'
const CREATE_DESCRIPTION = 'Create a scheduled task with one timing and an optional target. '
  + 'The default target creates one Session at first delivery and reuses it. '
  + 'After downtime, recurring tasks deliver only the latest missed occurrence. Delivery may repeat after a crash. '
  + MANAGEMENT_AUTHORIZATION
const LIST_DESCRIPTION = 'List Host scheduled tasks across Sessions, active tasks first, with pagination.'
const VIEW_DESCRIPTION = 'View one scheduled task by id.'
const EDIT_DESCRIPTION = 'Update, pause, resume, or delete one task. Omitted patch fields retain their stored values. '
  + 'Deletion does not retract queued messages. ' + MANAGEMENT_AUTHORIZATION

/** Deterministic model content for every canonical Schedule value. */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  // The ToolRuntime has already validated the value against the lossless-JSON output schema.
  const text = JSON.stringify(value)
  return [{ type: 'text', text }]
}

/** Pure generic pending card. */
function present(title: string, kind: 'read' | 'other', rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

/** Stable error for failures not safe to expose. */
function internalError(): InternalScheduleError {
  return { code: 'internal_error', message: 'The schedule operation failed.' }
}

/** Translate invalid input while withholding internal storage failures. */
function operationError(error: unknown): ScheduleToolError {
  return error instanceof ScheduleInputError ? { code: error.code, message: error.message } : internalError()
}

/**
 * Refuse a caller that is a delegated child. A subagent cannot use reminders at
 * all, so every tool rejects before dispatch instead of relying on the mounting
 * preset's tool filter alone.
 * @param agent - the calling agent, when the outer call has one.
 * @returns the stable refusal, or undefined for a top-level caller.
 */
function subagentCallerRefusal(agent: Agent | undefined): ScheduleToolError | undefined {
  if (agent === undefined || delegationDepthOf(agent) === 0) return undefined
  return { code: 'subagent_session', message: 'A delegated subagent cannot use reminders.' }
}

/**
 * Selector parameters shared by `schedule_create` and `schedule_edit`, in the order the
 * generated tool catalog states them.
 */
const SELECTOR_PARAMETERS = {
  every_seconds: {
    type: 'number',
    description: `Fixed-rate interval in whole seconds, at least ${MIN_EVERY_INTERVAL_SECONDS}, aligned to the creation time; changing it with schedule_edit re-aligns it to the save time.`,
  },
  daily: {
    type: 'object',
    additionalProperties: false,
    description: 'Every day at a local time.',
    properties: {
      time: { type: 'string', required: true, description: 'HH:mm:ss with optional 1-3 fractional digits, for example 23:00:00.' },
      time_zone: { type: 'string', required: true, description: 'UTC or IANA Area/Location, for example Asia/Shanghai.' },
    },
  },
  weekly: {
    type: 'object',
    additionalProperties: false,
    description: 'On the given weekdays at a local time.',
    properties: {
      time: { type: 'string', required: true, description: 'HH:mm:ss with optional 1-3 fractional digits, for example 09:00:00.' },
      time_zone: { type: 'string', required: true, description: 'UTC or IANA Area/Location, for example Asia/Shanghai.' },
      weekdays: {
        type: 'array',
        required: true,
        description: 'ISO weekdays, Monday 1 through Sunday 7, without repetitions.',
        items: { type: 'integer' },
      },
    },
  },
  cron: {
    type: 'object',
    additionalProperties: false,
    description: 'Five-field Vixie cron expression in a time zone.',
    properties: {
      expression: {
        type: 'string',
        required: true,
        description: 'minute hour day-of-month month day-of-week, for example "*/15 9-17 * * 1-5". '
          + 'When both day fields are restricted, a date matches if either one matches.',
      },
      time_zone: { type: 'string', required: true, description: 'UTC or IANA Area/Location, for example Asia/Shanghai.' },
    },
  },
  at: {
    description: 'Absolute target: an RFC 3339 date-time with offset, or a local date, time, and IANA time_zone.',
    oneOf: [
      { type: 'string' },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          date: { type: 'string', required: true },
          time: { type: 'string', required: true },
          time_zone: { type: 'string', required: true },
        },
      },
    ],
  },
} as const

/**
 * Register the four Schedule tools in the mounting scope.
 *
 * Each call mutates the Session of the Agent that dispatched it, so a mount
 * outside an agent scope still registers the tools but every call without a
 * caller Agent is refused as an internal failure.
 * @param ctx - Context owning the `tools` registry and the Host `schedule` service.
 */
const TIMING_SCHEMA = { oneOf: [
  { type: 'object', additionalProperties: false, properties: {
    kind: { type: 'string', const: 'after', required: true }, after_seconds: { type: 'integer', required: true },
  } },
  { type: 'object', additionalProperties: false, properties: {
    kind: { type: 'string', const: 'at', required: true }, at: { ...SELECTOR_PARAMETERS.at, required: true },
  } },
  { type: 'object', additionalProperties: false, properties: {
    kind: { type: 'string', const: 'every', required: true }, every_seconds: { ...SELECTOR_PARAMETERS.every_seconds, required: true },
  } },
  { type: 'object', additionalProperties: false, properties: {
    kind: { type: 'string', const: 'daily', required: true }, daily: { ...SELECTOR_PARAMETERS.daily, required: true },
  } },
  { type: 'object', additionalProperties: false, properties: {
    kind: { type: 'string', const: 'weekly', required: true }, weekly: { ...SELECTOR_PARAMETERS.weekly, required: true },
  } },
  { type: 'object', additionalProperties: false, properties: {
    kind: { type: 'string', const: 'cron', required: true }, cron: { ...SELECTOR_PARAMETERS.cron, required: true },
  } },
] } as const

export function apply(ctx: Context): void {
  ctx.inject(['schedule'], (scheduleCtx) => { registerScheduleTools(scheduleCtx) })
}

/** Convert a validated JSON destination identity to the service's branded value. */
function targetFrom(target: {
  kind: 'session'
  sessionId: string
} | { kind: 'new_once' | 'new'
  create?: { cwd?: string
    agentPreset?: string } } | undefined): ScheduleTargetRequest | undefined {
  if (target === undefined) return undefined
  return target.kind === 'session' ? { kind: 'session', sessionId: SessionId(target.sessionId) } : target
}

/**
 * Register the four model tools against the same Host management service.
 * @param ctx - Mounting scope; every mutation passes the actual acting Session.
 */
function registerScheduleTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'schedule_create', description: CREATE_DESCRIPTION,
    parameters: {
      title: { type: 'string', required: true, description: `Task name, at most ${MAX_TITLE_LENGTH} characters.` },
      prompt: { type: 'string', required: true, description: 'Instruction delivered at each occurrence.' },
      timing: { ...TIMING_SCHEMA, required: true }, target: TARGET_REQUEST_SCHEMA,
    },
    output: { schema: CREATE_OUTPUT_SCHEMA, render: renderValue },
    async execute(args, exec) {
      const refusal = subagentCallerRefusal(exec.agent)
      if (refusal !== undefined) return refusal
      if (exec.agent === undefined || exec.signal.aborted) return internalError()
      try {
        const { target, ...request } = args
        const destination = targetFrom(target)
        return await ctx.schedule.create({ ...request, ...(destination === undefined ? {} : { target: destination }) },
          exec.agent.session, exec.signal)
      }
      catch (error) { return operationError(error) }
    },
    presentCall: args => present('Create reminder', 'other', args.prompt),
  }))
  ctx.tools.register(defineTool({
    name: 'schedule_list', description: LIST_DESCRIPTION,
    parameters: { active: { type: 'boolean' }, limit: { type: 'integer' }, offset: { type: 'integer' } },
    output: { schema: LIST_OUTPUT_SCHEMA, render: renderValue },
    async execute(args, exec) {
      const refusal = subagentCallerRefusal(exec.agent)
      if (refusal !== undefined) return refusal
      if (exec.agent === undefined || exec.signal.aborted) return internalError()
      try { return await ctx.schedule.list(args) } catch (error) { return operationError(error) }
    },
    presentCall: () => present('List reminders', 'read'),
  }))
  ctx.tools.register(defineTool({
    name: 'schedule_view', description: VIEW_DESCRIPTION,
    parameters: { id: { type: 'string', required: true } },
    output: { schema: VIEW_OUTPUT_SCHEMA, render: renderValue },
    async execute(args, exec) {
      const refusal = subagentCallerRefusal(exec.agent)
      if (refusal !== undefined) return refusal
      if (exec.agent === undefined || exec.signal.aborted) return internalError()
      try { return await ctx.schedule.view({ id: ScheduleId(args.id) }) } catch (error) { return operationError(error) }
    },
    presentCall: args => present('View reminder', 'read', args.id),
  }))
  ctx.tools.register(defineTool({
    name: 'schedule_edit', description: EDIT_DESCRIPTION,
    parameters: {
      id: { type: 'string', required: true },
      action: { type: 'string', required: true, enum: ['update', 'delete'] },
      expectedUpdatedAt: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      patch: { type: 'object', additionalProperties: false, properties: {
        title: { type: 'string' }, prompt: { type: 'string' }, timing: TIMING_SCHEMA,
        target: TARGET_REQUEST_SCHEMA, active: { type: 'boolean' },
      } },
    },
    output: { schema: EDIT_OUTPUT_SCHEMA, render: renderValue },
    async execute(args, exec) {
      const refusal = subagentCallerRefusal(exec.agent)
      if (refusal !== undefined) return refusal
      if (exec.agent === undefined || exec.signal.aborted) return internalError()
      try {
        const id = ScheduleId(args.id)
        const revision = args.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: args.expectedUpdatedAt }
        if (args.action === 'delete') {
          if (args.patch !== undefined) return { code: 'invalid_rule' as const, message: 'Deletion cannot carry a patch.' }
          return await ctx.schedule.edit({ id, action: 'delete', ...revision }, exec.agent.session, exec.signal)
        }
        if (args.patch === undefined) return { code: 'invalid_rule' as const, message: 'An update requires a patch.' }
        const { target, ...patch } = args.patch
        const destination = targetFrom(target)
        return await ctx.schedule.edit({ id, action: 'update', ...revision,
          patch: { ...patch, ...(destination === undefined ? {} : { target: destination }) },
        }, exec.agent.session, exec.signal)
      } catch (error) { return operationError(error) }
    },
    presentCall: args => present('Edit reminder', 'other', args.id),
  }))
}
