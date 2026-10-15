import { afterEach, describe, expect, it } from 'vitest'
import { setupAssistantHarness, type AssistantTestHarness } from './harness.ts'
import {
  createAssistantCreateTool,
  createTeamCreateTool,
  installCreationTools,
} from '../src/creation-tool.ts'
import { AssistantProfileId } from '../src/types.ts'

describe('Model Creation Tools (S19)', () => {
  let harness: AssistantTestHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.dispose()
      harness = undefined
    }
  })

  it('exposes assistant_create tool with name, responsibility, instructions', async () => {
    harness = await setupAssistantHarness()
    const { assistants, lead } = harness

    const tool = createAssistantCreateTool(assistants)
    expect(tool.name).toBe('assistant_create')
    const params = tool.parameters as { properties: Record<string, unknown>; required?: string[] }
    expect(params.properties.name).toBeDefined()
    expect(params.properties.responsibility).toBeDefined()
    expect(params.required).toContain('name')
    expect(params.required).toContain('responsibility')
    expect(params.required).not.toContain('instructions')

    const result = (await tool.execute(
      {
        name: 'Tool Creator',
        responsibility: 'Creates tools for models',
        instructions: 'Always validate arguments',
      },
      { agent: lead, signal: new AbortController().signal } as never,
    )) as {
      id: string
      name: string
      responsibility: string
      instructions?: string
      revision: number
    }

    expect(result.id).toBeDefined()
    expect(result.name).toBe('Tool Creator')
    expect(result.responsibility).toBe('Creates tools for models')
    expect(result.instructions).toBe('Always validate arguments')
    expect(result.revision).toBe(1)

    const retrieved = await assistants.getProfile(AssistantProfileId(result.id))
    expect(retrieved).toBeDefined()
    expect(retrieved!.name).toBe('Tool Creator')
  })

  it('renders human-readable text for assistant_create execution', async () => {
    harness = await setupAssistantHarness()
    const { assistants } = harness

    const tool = createAssistantCreateTool(assistants)
    const rendered = tool.output?.render?.(
      { name: 'X', responsibility: 'Y' },
      { id: 'asst-1', name: 'X', responsibility: 'Y', revision: 1 },
    )
    const firstBlock = rendered?.[0]
    expect(firstBlock?.type).toBe('text')
    if (firstBlock?.type === 'text') {
      expect(firstBlock.text).toContain('Created assistant profile "X"')
    }
  })

  it('exposes team_create tool with template support', async () => {
    harness = await setupAssistantHarness()
    const { assistants, lead } = harness

    const coordinator = await assistants.createProfile({
      name: 'Team Lead',
      responsibility: 'Coordinates team tasks',
    })

    const tool = createTeamCreateTool(assistants)
    expect(tool.name).toBe('team_create')
    const params = tool.parameters as { properties: Record<string, unknown>; required?: string[] }
    expect(params.properties.name).toBeDefined()
    expect(params.properties.coordinatorProfileId).toBeDefined()
    expect(params.required).toContain('name')
    expect(params.required).toContain('coordinatorProfileId')

    // Create blank team
    const resultBlank = (await tool.execute(
      {
        name: 'Custom Team',
        coordinatorProfileId: coordinator.id,
        description: 'A custom squad',
      },
      { agent: lead, signal: new AbortController().signal } as never,
    )) as {
      id: string
      name: string
      coordinatorProfileId: string
      revision: number
    }

    expect(resultBlank.id).toBeDefined()
    expect(resultBlank.name).toBe('Custom Team')
    expect(resultBlank.coordinatorProfileId).toBe(coordinator.id)

    // Create templated team (case squad)
    const resultTemplated = (await tool.execute(
      {
        name: 'Investigation Squad',
        coordinatorProfileId: coordinator.id,
        template: 'case',
      },
      { agent: lead, signal: new AbortController().signal } as never,
    )) as {
      id: string
      name: string
      coordinatorProfileId: string
      template?: string
      revision: number
    }

    expect(resultTemplated.id).toBeDefined()
    expect(resultTemplated.template).toBe('case')

    const team = await assistants.getTeam(resultTemplated.id as never)
    expect(team).toBeDefined()
    const seats = await assistants.listSeats(team!.id)
    expect(seats.length).toBeGreaterThan(0)
  })

  it('registers assistant_create and team_create tools in tools runtime on service startup', async () => {
    harness = await setupAssistantHarness()
    const { ctx } = harness

    expect(ctx.tools.get('assistant_create')).toBeDefined()
    expect(ctx.tools.get('team_create')).toBeDefined()
  })

  it('installs tools into Context tools runtime via installCreationTools and unmounts cleanly', async () => {
    harness = await setupAssistantHarness()
    const { ctx, assistants } = harness

    // Dispose initial registration from service startup
    assistants.creationToolsDisposer()
    expect(ctx.tools.get('assistant_create')).toBeUndefined()
    expect(ctx.tools.get('team_create')).toBeUndefined()

    const unmount = installCreationTools(ctx, assistants)
    expect(ctx.tools.get('assistant_create')).toBeDefined()
    expect(ctx.tools.get('team_create')).toBeDefined()

    unmount()
    expect(ctx.tools.get('assistant_create')).toBeUndefined()
    expect(ctx.tools.get('team_create')).toBeUndefined()
  })

  it('rejects team_create when coordinator profile is not found', async () => {
    harness = await setupAssistantHarness()
    const { assistants, lead } = harness

    const tool = createTeamCreateTool(assistants)
    await expect(
      tool.execute(
        {
          name: 'Ghost Team',
          coordinatorProfileId: 'non-existent-profile',
        },
        { agent: lead, signal: new AbortController().signal } as never,
      ),
    ).rejects.toThrow(/not found/)
  })
})
