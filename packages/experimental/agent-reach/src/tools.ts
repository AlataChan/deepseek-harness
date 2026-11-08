/**
 * Model-facing Agent-Reach tools and reversible registration.
 *
 * @module @deepseek-ai/dsh-experimental-agent-reach/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { renderQueryResult } from './presentation.ts'
import type { AgentReachRunner } from './runner.ts'
import type { AgentReachSetupService } from './setup.ts'

/** Tool availability independent of runtime installation state. */
export interface ReachToolsRegistrationOptions {
  readonly enableSetupTool?: boolean
}

/**
 * Register Agent-Reach tools with the active tools runtime.
 * Returns a disposal function to unregister all tools cleanly.
 *
 * @param ctx - Cordis Context
 * @param runner - AgentReachRunner instance
 * @param setupService - AgentReachSetupService instance
 * @param options - tool enablement options
 * @returns disposer function
 */
export function registerReachTools(
  ctx: Context,
  runner: AgentReachRunner,
  setupService: AgentReachSetupService,
  options: ReachToolsRegistrationOptions = {},
): () => void {
  const tools = ctx.tools

  const disposers: Array<() => void> = []

  // 1. reach_channels (read-only)
  const channelsTool = tools.register(
    defineTool({
      name: 'reach_channels',
      description:
        'Discover available external platform channels, actions, parameters, backends, and classified side effects.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            channels: { type:'array',required:true,items:{ type:'object',additionalProperties:false,properties:{
              name:{ type:'string',required:true },enabled:{ type:'boolean',required:true },
              description:{ type:'string',required:true },level:{ type:'string',required:true },
              actions:{ type:'array',required:true,items:{ type:'object',additionalProperties:false,properties:{
                name:{ type:'string',required:true },help:{ type:'string',required:true },usage:{ type:'string' },
                backends:{ type:'array',required:true,items:{ type:'object',additionalProperties:false,properties:{
                  name:{ type:'string',required:true },sideEffects:{ type:'array',required:true,items:{ type:'string' } },
                } } },
                params:{ type:'array',required:true,items:{ type:'object',additionalProperties:false,properties:{
                  name:{ type:'string',required:true },type:{ type:'string',required:true },
                  required:{ type:'boolean',required:true },help:{ type:'string',required:true },default:{ type:'json' },
                } } },
                publicWeb:{ type:'array',items:{ type:'string' } },
              } } },
            } } },
          },
        },
        render(_args, value) {
          const channels = value.channels
          const count = channels.length
          const lines = [`Discovered ${count} Agent-Reach channels.`]
          for (const channel of channels) {
            lines.push(`\nChannel: ${channel.name} [${channel.level}; enabled=${channel.enabled}] - ${channel.description}`)
            for (const action of channel.actions) {
              const backends=action.backends.map(backend=>`${backend.name} (effects: ${JSON.stringify(backend.sideEffects)})`).join(', ')
              lines.push(`  Action: ${action.name} - ${action.help}${backends ? ` [backends: ${backends}]` : ''}`)
              if(action.params.length>0) {
                lines.push('    Parameters:')
                for(const param of action.params) {
                  const required=param.required ? 'required' : 'optional'
                  const initial=param.default!==undefined && param.default!==null ? `, default: ${JSON.stringify(param.default)}` : ''
                  lines.push(`      - ${param.name} (${param.type}, ${required}${initial}): ${param.help}`)
                }
              }
            }
          }
          return [{ type: 'text', text: lines.join('\n') }]
        },
        presentationMeta(_args, value) {
          const count = value.channels.length
          return { kind: 'channels', channelCount: count }
        },
      },
      async execute() {
        const res = await runner.channels()
        const channels = res.channels.map(ch => ({
          name: ch.name,
          enabled: runner.config.enabledChannels.includes(ch.name),
          description: ch.description,
          level: ch.level,
          actions: ch.actions.map(act => ({
            name: act.name,
            help: act.help,
            ...(act.usage !== undefined ? { usage: act.usage } : {}),
            backends: act.backends.map(b => ({
              name: b.name,
              sideEffects: [...b.sideEffects],
            })),
            params: act.params.map(p => ({
              name: p.name,
              type: p.type,
              required: p.required,
              help: p.help,
              ...(p.default !== undefined ? { default: p.default } : {}),
            })),
            ...(act.publicWeb !== undefined ? { publicWeb: [...act.publicWeb] } : {}),
          })),
        }))
        return {
          ok: res.ok,
          channels,
        }
      },
    }),
  )
  disposers.push(channelsTool)

  // 2. reach_status (read-only)
  const statusTool = tools.register(
    defineTool({
      name: 'reach_status',
      description: 'Inspect local Agent-Reach installation status, version, and channel readiness.',
      parameters: {
        channel: { type: 'string', description: 'Optional channel name to inspect' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            version: { type: 'string' },
            error: {
              type: 'object',
              additionalProperties: false,
              properties: {
                code: { type: 'string', required: true },
                message: { type: 'string', required: true },
                hint: { type: 'string' },
              },
            },
            doctor: { type: 'object', additionalProperties: true },
          },
        },
        render(_args, value) {
          if (!value.ok) {
            return [{ type: 'text', text: `Agent-Reach status: ${value.error?.message || 'Not ready'}` }]
          }
          return [{ type: 'text', text: `Agent-Reach status: OK (v${value.version || 'unknown'})` }]
        },
        presentationMeta(_args, value) {
          return {
            kind: 'status',
            ok: value.ok,
            ...(_args.channel !== undefined ? { channel: _args.channel } : {}),
            ...(value.version !== undefined ? { version: value.version } : {}),
            ...(value.error?.code !== undefined ? { errorCode: value.error.code } : {}),
          }
        },
      },
      async execute(args) {
        const res = await runner.status(args.channel)
        const doctor =
          typeof res.doctor === 'object' && res.doctor !== null && !Array.isArray(res.doctor)
            ? (res.doctor as Record<string, JsonValue>)
            : undefined
        return {
          ok: res.ok,
          ...(res.version !== undefined ? { version: res.version } : {}),
          ...(res.error !== undefined
            ? {
              error: {
                code: res.error.code,
                message: res.error.message,
                ...(res.error.hint !== undefined ? { hint: res.error.hint } : {}),
              },
            }
            : {}),
          ...(doctor !== undefined ? { doctor } : {}),
        }
      },
    }),
  )
  disposers.push(statusTool)

  // 3. reach_query (read-only)
  const queryTool = tools.register(
    defineTool({
      name: 'reach_query',
      description:
        'Query an external platform (e.g. Bilibili, YouTube, V2EX) for bounded read operations. Missing dependencies return NEED_SETUP.',
      parameters: {
        channel: { type: 'string', required: true, description: 'Target platform channel (e.g. bilibili, youtube, v2ex)' },
        action: { type: 'string', required: true, description: 'Target channel action (e.g. search, read, subtitle, hot)' },
        params: { type: 'object', additionalProperties: true, description: 'Action-specific parameters' },
        backend: { type: 'string', description: 'Optional declared backend (e.g. bili-cli, yt-dlp)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            channel: { type: 'string', required: true },
            action: { type: 'string', required: true },
            backend: { type: 'string' },
            items: { type: 'array', required: true },
            meta: {
              type: 'object',
              additionalProperties: true,
              required: true,
              properties: {
                elapsedMs: { type: 'number', required: true },
                attempts: { type: 'array', required: true },
              },
            },
            accessScope: { type: 'string', required: true },
            completeness: { type: 'string', required: true },
            truncated: { type: 'boolean' },
            error: {
              type: 'object',
              additionalProperties: false,
              properties: {
                code: { type: 'string', required: true },
                message: { type: 'string', required: true },
                hint: { type: 'string' },
              },
            },
          },
        },
        render(_args, value) {
          return [{ type: 'text', text: renderQueryResult(value) }]
        },
        presentationMeta(_args, value) {
          return {
            kind: 'query',
            channel: value.channel,
            action: value.action,
            accessScope: value.accessScope,
            itemCount: value.items.length,
            completeness: value.completeness,
            elapsedMs: value.meta.elapsedMs,
            ...(value.backend !== undefined ? { backend: value.backend } : {}),
            ...(value.truncated !== undefined ? { truncated: value.truncated } : {}),
            ...(value.error?.code !== undefined ? { errorCode: value.error.code } : {}),
          }
        },
      },
      async execute(args, exec) {
        const res = await runner.query({
          channel: args.channel,
          action: args.action,
          params: args.params ?? {},
          ...(args.backend !== undefined ? { backend: args.backend } : {}),
          signal: exec.signal,
        })
        const items = res.items.map(it => ({
          ...(it.title !== undefined ? { title: it.title } : {}),
          ...(it.url !== undefined ? { url: it.url } : {}),
          ...(it.author !== undefined ? { author: it.author } : {}),
          ...(it.publishedAt !== undefined ? { publishedAt: it.publishedAt } : {}),
          ...(it.text !== undefined ? { text: it.text } : {}),
        }))
        const attempts = [...res.meta.attempts]
        return {
          ok: res.ok,
          channel: res.channel,
          action: res.action,
          accessScope: res.accessScope,
          completeness: res.completeness,
          items,
          meta: {
            elapsedMs: res.meta.elapsedMs,
            attempts,
            ...(res.meta.accessMode !== undefined ? { accessMode: res.meta.accessMode } : {}),
            ...(res.meta.completenessVerified !== undefined ? { completenessVerified: res.meta.completenessVerified } : {}),
          },
          ...(res.backend !== undefined ? { backend: res.backend } : {}),
          ...(res.truncated !== undefined ? { truncated: res.truncated } : {}),
          ...(res.error !== undefined
            ? {
              error: {
                code: res.error.code,
                message: res.error.message,
                ...(res.error.hint !== undefined ? { hint: res.error.hint } : {}),
              },
            }
            : {}),
        }
      },
    }),
  )
  disposers.push(queryTool)

  // 4. reach_setup (mutating dependency installer, gated)
  const enableSetup = options.enableSetupTool ?? true
  if (enableSetup) {
    const setupTool = tools.register(
      defineTool({
        name: 'reach_setup',
        description:
          'Inspect or install missing platform prerequisites for a specific channel and action after user confirmation.',
        parameters: {
          channel: { type: 'string', required: true, description: 'Channel requiring prerequisites' },
          action: { type: 'string', required: true, description: 'Action requiring prerequisites' },
          backend: { type: 'string', description: 'Optional declared backend' },
          planOnly: { type: 'boolean', description: 'If true, compute and inspect installation plan without installing' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true },
              channel: { type: 'string', required: true },
              action: { type: 'string', required: true },
              status: { type: 'string', required: true },
              message: { type: 'string', required: true },
              plan: { type: 'object', additionalProperties: true },
              error: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  code: { type: 'string', required: true },
                  message: { type: 'string', required: true },
                },
              },
            },
          },
          render(_args, value) {
            return [{ type: 'text', text: `Agent-Reach setup [${value.channel}/${value.action}]: ${value.message}` }]
          },
          presentationMeta(_args, value) {
            return {
              kind: 'setup',
              channel: value.channel,
              action: value.action,
              status: value.status,
              ...(_args.planOnly !== undefined ? { planOnly: _args.planOnly } : {}),
            }
          },
        },
        async execute(args, exec) {
          const res = await setupService.runSetup(args.channel, args.action, args.backend, {
            planOnly: args.planOnly === true,
            agent: exec.agent,
            callId: exec.callId,
            signal: exec.signal,
          })
          const planRecord: Record<string, JsonValue> | undefined =
            res.plan !== undefined
              ? {
                channel: res.plan.channel,
                action: res.plan.action,
                ...(res.plan.backend !== undefined ? { backend: res.plan.backend } : {}),
                lockId: res.plan.lockId,
                releaseRoot: res.plan.releaseRoot,
                manifestDigest: res.plan.manifestDigest,
                packages: res.plan.packages.map(p => ({
                  name: p.name,
                  version: p.version,
                  role: p.role,
                  destinationVenv: p.destinationVenv,
                  license: p.license,
                  ...(p.toolKey !== undefined ? { toolKey: p.toolKey } : {}),
                })),
                sideEffects: [...res.plan.sideEffects],
                needsCoreInstall: res.plan.needsCoreInstall,
                needsToolInstall: res.plan.needsToolInstall,
                isFullyProvisioned: res.plan.isFullyProvisioned,
                licenseSummary: [...res.plan.licenseSummary],
              }
              : undefined

          return {
            ok: res.ok,
            channel: res.channel,
            action: res.action,
            status: res.status,
            message: res.message,
            ...(planRecord !== undefined ? { plan: planRecord } : {}),
            ...(res.error !== undefined
              ? {
                error: {
                  code: res.error.code,
                  message: res.error.message,
                },
              }
              : {}),
          }
        },
      }),
    )
    disposers.push(setupTool)
  }

  return () => {
    for (const dispose of disposers) {
      dispose()
    }
  }
}
