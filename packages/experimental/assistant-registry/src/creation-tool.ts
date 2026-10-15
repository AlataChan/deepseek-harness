/**
 * Model-facing assistant and team creation tools (S19).
 * Exposes assistant_create and team_create tools with Host surface parity.
 * @module @deepseek-ai/dsh-experimental-assistant-registry/creation-tool
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import {
  AssistantProfileId,
  type TeamTemplateOrigin,
} from './types.ts'
import type { AssistantService } from './index.ts'

/**
 * Creates the model-facing `assistant_create` tool definition.
 * @param assistants - Assistant service managing catalog and profiles.
 * @returns Tool definition for assistant profile creation.
 */
export function createAssistantCreateTool(assistants: AssistantService): ToolDefinition {
  return defineTool({
    name: 'assistant_create',
    description:
      'Create a new persistent assistant profile with dedicated responsibility and optional instructions. ' +
      'Once created, conversations can be started under this assistant.',
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: 'Assistant display name (1-64 characters).',
      },
      responsibility: {
        type: 'string',
        required: true,
        description: 'Primary responsibility and role definition of the assistant.',
      },
      instructions: {
        type: 'string',
        description: 'Optional system instructions and behavioral guidelines for the assistant.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          responsibility: { type: 'string', required: true },
          instructions: { type: 'string' },
          revision: { type: 'integer', required: true },
        },
      },
      render: (_args, value: { id: string; name: string; revision: number }) => [
        {
          type: 'text',
          text: `Created assistant profile "${value.name}" (id: ${value.id}, revision: ${value.revision}).`,
        },
      ],
    },
    async execute(args: { name: string; responsibility: string; instructions?: string }) {
      const profile = await assistants.createProfile({
        name: args.name,
        responsibility: args.responsibility,
        ...args.instructions !== undefined ? { instructions: args.instructions } : {},
      })
      return {
        id: profile.id,
        name: profile.name,
        responsibility: profile.responsibility,
        ...profile.instructions !== undefined ? { instructions: profile.instructions } : {},
        revision: profile.revision,
      }
    },
  })
}

/**
 * Creates the model-facing `team_create` tool definition.
 * @param assistants - Assistant service managing teams and seats.
 * @returns Tool definition for team squad creation.
 */
export function createTeamCreateTool(assistants: AssistantService): ToolDefinition {
  return defineTool({
    name: 'team_create',
    description:
      'Create a new persistent agent team squad definition with a designated coordinator assistant. ' +
      'Optional templates (blank, document, case, comms) pre-populate standard seats.',
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: 'Team squad name.',
      },
      coordinatorProfileId: {
        type: 'string',
        required: true,
        description: 'Assistant profile ID of the coordinator leading the team.',
      },
      description: {
        type: 'string',
        description: 'Optional overall squad duty and objective description.',
      },
      template: {
        type: 'string',
        description: 'Optional template origin: blank, document, case, or comms.',
        enum: ['blank', 'document', 'case', 'comms'],
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          coordinatorProfileId: { type: 'string', required: true },
          description: { type: 'string' },
          template: { type: 'string' },
          revision: { type: 'integer', required: true },
        },
      },
      render: (_args, value: { id: string; name: string; coordinatorProfileId: string; revision: number }) => [
        {
          type: 'text',
          text: `Created team squad "${value.name}" (id: ${value.id}, coordinator: ${value.coordinatorProfileId}, revision: ${value.revision}).`,
        },
      ],
    },
    async execute(args: {
      name: string
      coordinatorProfileId: string
      description?: string
      template?: string
    }) {
      const template = args.template as TeamTemplateOrigin | undefined
      if (template) {
        const { team } = await assistants.createTeamFromTemplate(template, {
          name: args.name,
          coordinatorProfileId: AssistantProfileId(args.coordinatorProfileId),
          ...args.description !== undefined ? { description: args.description } : {},
        })
        return {
          id: team.id,
          name: team.name,
          coordinatorProfileId: team.coordinatorProfileId,
          ...team.description !== undefined ? { description: team.description } : {},
          ...team.templateOrigin !== undefined ? { template: team.templateOrigin } : {},
          revision: team.revision,
        }
      }

      const team = await assistants.createTeam({
        name: args.name,
        coordinatorProfileId: AssistantProfileId(args.coordinatorProfileId),
        ...args.description !== undefined ? { description: args.description } : {},
        ...template !== undefined ? { templateOrigin: template } : {},
      })
      return {
        id: team.id,
        name: team.name,
        coordinatorProfileId: team.coordinatorProfileId,
        ...team.description !== undefined ? { description: team.description } : {},
        ...team.templateOrigin !== undefined ? { template: team.templateOrigin } : {},
        revision: team.revision,
      }
    },
  })
}

/**
 * Installs model-facing creation tools into the Cordis tools runtime.
 * @param ctx - Cordis context carrying tool runtime.
 * @param assistants - Assistant service managing catalog.
 * @returns Disposer function to unregister tools.
 */
export function installCreationTools(ctx: Context, assistants: AssistantService): () => void {
  const disposers: Array<() => void> = []

  const tools = ctx.get('tools', false)
  if (tools) {
    disposers.push(tools.register(createAssistantCreateTool(assistants)))
    disposers.push(tools.register(createTeamCreateTool(assistants)))
  } else {
    const fiber = ctx.inject(['tools'], (toolsCtx) => {
      const liveTools = toolsCtx.get('tools', false)
      if (liveTools) {
        disposers.push(liveTools.register(createAssistantCreateTool(assistants)))
        disposers.push(liveTools.register(createTeamCreateTool(assistants)))
      }
    })
    disposers.push(() => { void fiber.dispose() })
  }

  return () => {
    for (const d of disposers) d()
    disposers.length = 0
  }
}
