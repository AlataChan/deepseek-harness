/**
 * Zod schemas and storage-domain declaration for the assistants catalog.
 * @module @deepseek-ai/dsh-experimental-assistant-registry/schema
 */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import {
  AssistantProfileId,
  AssistantConversationId,
  ProvisioningOperationId,
  TeamDefinitionId,
  TeamSeatId,
  MemoryEntryId,
  MEMORY_TEXT_MAX_LENGTH,
  type AssistantProfile,
  type AssistantConversation,
  type ProvisioningOperation,
  type TeamDefinition,
  type TeamSeat,
  type CapabilityPolicy,
  type InstitutionAdoptionRecord,
  type MemoryEntry,
  type MemoryScope,
} from './types.ts'

/** Zod schema for capability policy. */
export const capabilityPolicySchema: z.ZodType<CapabilityPolicy> = z.object({
  allowedTools: z.array(z.string().min(1)).optional(),
  disallowedTools: z.array(z.string().min(1)).optional(),
  allowedPaths: z.array(z.string().min(1)).optional(),
  allowTerminal: z.boolean().optional(),
  allowSubagents: z.boolean().optional(),
}).strict().transform((val): CapabilityPolicy => ({
  ...val.allowedTools !== undefined ? { allowedTools: val.allowedTools } : {},
  ...val.disallowedTools !== undefined ? { disallowedTools: val.disallowedTools } : {},
  ...val.allowedPaths !== undefined ? { allowedPaths: val.allowedPaths } : {},
  ...val.allowTerminal !== undefined ? { allowTerminal: val.allowTerminal } : {},
  ...val.allowSubagents !== undefined ? { allowSubagents: val.allowSubagents } : {},
}))

/** Zod schema for model selection route. */
export const modelSelectionSchema: z.ZodType<ModelSelection> = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().transform(v => brandString<ReasoningEffortId>(v)).optional(),
}).strict().transform((val): ModelSelection => ({
  provider: val.provider,
  model: val.model,
  ...val.reasoningEffort !== undefined ? { reasoningEffort: val.reasoningEffort } : {},
}))

/** Zod schema for persistent assistant profile records. */
export const assistantProfileSchema: z.ZodType<AssistantProfile> = z.object({
  id: z.string().min(1).transform(AssistantProfileId),
  name: z.string().min(1),
  avatar: z.string().optional(),
  responsibility: z.string().min(1),
  instructions: z.string().optional(),
  capabilities: capabilityPolicySchema.optional(),
  revision: z.number().int().min(1),
  defaultModel: modelSelectionSchema.optional(),
  archivedAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).strict().transform((val): AssistantProfile => ({
  id: val.id,
  name: val.name,
  ...val.avatar !== undefined ? { avatar: val.avatar } : {},
  responsibility: val.responsibility,
  ...val.instructions !== undefined ? { instructions: val.instructions } : {},
  ...val.capabilities !== undefined ? { capabilities: val.capabilities } : {},
  revision: val.revision,
  ...val.defaultModel !== undefined ? { defaultModel: val.defaultModel } : {},
  ...val.archivedAt !== undefined ? { archivedAt: val.archivedAt } : {},
  createdAt: val.createdAt,
  updatedAt: val.updatedAt,
}))

/** Zod schema for provisioning status enum. */
export const provisioningStatusSchema = z.enum([
  'pending',
  'checkpointed',
  'completed',
  'failed',
  'ambiguous',
])

/** Zod schema for provisioning operation records. */
export const provisioningOperationSchema: z.ZodType<ProvisioningOperation> = z.object({
  id: z.string().min(1).transform(ProvisioningOperationId),
  fingerprint: z.string().min(1),
  status: provisioningStatusSchema,
  checkpoint: z.string().min(1),
  allocations: z.record(z.string(), z.string()),
  payload: z.unknown(),
  error: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).strict().transform((val): ProvisioningOperation => ({
  id: val.id,
  fingerprint: val.fingerprint,
  status: val.status,
  checkpoint: val.checkpoint,
  allocations: val.allocations,
  payload: val.payload,
  ...val.error !== undefined ? { error: val.error } : {},
  createdAt: val.createdAt,
  updatedAt: val.updatedAt,
}))

/** Zod schema for assistant conversation binding records. */
export const assistantConversationSchema: z.ZodType<AssistantConversation> = z.object({
  id: z.string().min(1).transform(AssistantConversationId),
  profileId: z.string().min(1).transform(AssistantProfileId),
  rootSessionId: z.string().min(1).transform(SessionId),
  title: z.string().optional(),
  modelOverride: modelSelectionSchema.optional(),
  modelCheckpoint: z.number().optional(),
  capabilities: capabilityPolicySchema.optional(),
  archivedAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).strict().transform((val): AssistantConversation => ({
  id: val.id,
  profileId: val.profileId,
  rootSessionId: val.rootSessionId,
  ...val.title !== undefined ? { title: val.title } : {},
  ...val.modelOverride !== undefined ? { modelOverride: val.modelOverride } : {},
  ...val.modelCheckpoint !== undefined ? { modelCheckpoint: val.modelCheckpoint } : {},
  ...val.capabilities !== undefined ? { capabilities: val.capabilities } : {},
  ...val.archivedAt !== undefined ? { archivedAt: val.archivedAt } : {},
  createdAt: val.createdAt,
  updatedAt: val.updatedAt,
}))

/** Zod schema for team seat role enum. */
export const teamSeatRoleSchema = z.enum(['coordinator', 'teammate'])

/** Zod schema for team seat records. */
export const teamSeatSchema: z.ZodType<TeamSeat> = z.object({
  id: z.string().min(1).transform(TeamSeatId),
  teamId: z.string().min(1).transform(TeamDefinitionId),
  profileId: z.string().min(1).transform(AssistantProfileId),
  role: teamSeatRoleSchema,
  name: z.string().min(1),
  duty: z.string().min(1),
  title: z.string().optional(),
  modelOverride: modelSelectionSchema.optional(),
  capabilities: capabilityPolicySchema.optional(),
  runtimeInstances: z.array(z.string().min(1).transform(SessionId)).default([]),
  runtimeNames: z.array(z.string().min(1)).optional(),
  activeInstanceId: z.string().min(1).transform(SessionId).optional(),
  retiredAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).strict().transform((val): TeamSeat => ({
  id: val.id,
  teamId: val.teamId,
  profileId: val.profileId,
  role: val.role,
  name: val.name,
  duty: val.duty,
  ...val.title !== undefined ? { title: val.title } : {},
  ...val.modelOverride !== undefined ? { modelOverride: val.modelOverride } : {},
  ...val.capabilities !== undefined ? { capabilities: val.capabilities } : {},
  runtimeInstances: val.runtimeInstances,
  ...val.runtimeNames !== undefined ? { runtimeNames: val.runtimeNames } : {},
  ...val.activeInstanceId !== undefined ? { activeInstanceId: val.activeInstanceId } : {},
  ...val.retiredAt !== undefined ? { retiredAt: val.retiredAt } : {},
  createdAt: val.createdAt,
  updatedAt: val.updatedAt,
}))

/** Zod schema for team template origin enum. */
export const teamTemplateOriginSchema = z.enum(['blank', 'document', 'case', 'comms'])

/** Zod schema for team definition records. */
export const teamDefinitionSchema: z.ZodType<TeamDefinition> = z.object({
  id: z.string().min(1).transform(TeamDefinitionId),
  name: z.string().min(1),
  description: z.string().optional(),
  avatar: z.string().optional(),
  coordinatorProfileId: z.string().min(1).transform(AssistantProfileId),
  leadSessionId: z.string().min(1).transform(SessionId).optional(),
  sharedWorkspaceId: z.string().optional(),
  templateOrigin: teamTemplateOriginSchema.optional(),
  seatIds: z.array(z.string().min(1).transform(TeamSeatId)).default([]),
  capabilities: capabilityPolicySchema.optional(),
  revision: z.number().int().min(1),
  archivedAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).strict().transform((val): TeamDefinition => ({
  id: val.id,
  name: val.name,
  ...val.description !== undefined ? { description: val.description } : {},
  ...val.avatar !== undefined ? { avatar: val.avatar } : {},
  coordinatorProfileId: val.coordinatorProfileId,
  ...val.leadSessionId !== undefined ? { leadSessionId: val.leadSessionId } : {},
  ...val.sharedWorkspaceId !== undefined ? { sharedWorkspaceId: val.sharedWorkspaceId } : {},
  ...val.templateOrigin !== undefined ? { templateOrigin: val.templateOrigin } : {},
  seatIds: val.seatIds,
  ...val.capabilities !== undefined ? { capabilities: val.capabilities } : {},
  revision: val.revision,
  ...val.archivedAt !== undefined ? { archivedAt: val.archivedAt } : {},
  createdAt: val.createdAt,
  updatedAt: val.updatedAt,
}))

/** Zod schema for institution adoption status enum. */
export const institutionAdoptionStatusSchema = z.enum(['active', 'repair_needed', 'superseded'])

/** Zod schema for institution adoption records. */
export const institutionAdoptionSchema: z.ZodType<InstitutionAdoptionRecord> = z.object({
  id: z.string().min(1),
  squadId: z.enum(['document', 'case', 'comms']),
  teamId: z.string().min(1).transform(TeamDefinitionId),
  leadSessionId: z.string().min(1).transform(SessionId),
  seatMappings: z.record(z.string(), z.string().transform(SessionId)),
  status: institutionAdoptionStatusSchema,
  revision: z.number().int().min(1),
  adoptedAt: z.number(),
  updatedAt: z.number(),
  error: z.string().optional(),
}).strict().transform((val): InstitutionAdoptionRecord => ({
  id: val.id,
  squadId: val.squadId,
  teamId: val.teamId,
  leadSessionId: val.leadSessionId,
  seatMappings: val.seatMappings,
  status: val.status,
  revision: val.revision,
  adoptedAt: val.adoptedAt,
  updatedAt: val.updatedAt,
  ...val.error !== undefined ? { error: val.error } : {},
}))

/** Zod schema for memory scope. */
export const memoryScopeSchema: z.ZodType<MemoryScope> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('profile'), profileId: z.string().min(1).transform(AssistantProfileId) }),
  z.object({ kind: z.literal('team'), teamId: z.string().min(1).transform(TeamDefinitionId) }),
])

/** Zod schema for memory entries. */
export const memoryEntrySchema: z.ZodType<MemoryEntry> = z.object({
  id: z.string().min(1).transform(MemoryEntryId),
  scope: memoryScopeSchema,
  text: z.string().min(1).max(MEMORY_TEXT_MAX_LENGTH),
  sourceSessionId: z.string().min(1).transform(SessionId).optional(),
  sourceEventSeq: z.number().int().optional(),
  author: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  revision: z.number().int().min(1),
  removedAt: z.number().optional(),
  archivedAt: z.number().optional(),
  grants: z.array(z.string().min(1).transform(TeamDefinitionId)).optional(),
}).strict().transform((val): MemoryEntry => ({
  id: val.id,
  scope: val.scope,
  text: val.text,
  ...val.sourceSessionId !== undefined ? { sourceSessionId: val.sourceSessionId } : {},
  ...val.sourceEventSeq !== undefined ? { sourceEventSeq: val.sourceEventSeq } : {},
  ...val.author !== undefined ? { author: val.author } : {},
  createdAt: val.createdAt,
  updatedAt: val.updatedAt,
  revision: val.revision,
  ...val.removedAt !== undefined ? { removedAt: val.removedAt } : {},
  ...val.archivedAt !== undefined ? { archivedAt: val.archivedAt } : {},
  ...val.grants !== undefined ? { grants: val.grants } : {},
}))

/**
 * Storage domain spec for the assistants catalog (`~/.dsh/storages/assistants.json`).
 * Defines tables for profiles, operations, conversation bindings, teams, seats, adoptions, and memory under a single-document layout.
 */
export const assistantsDomainSpec = defineDomain({
  name: 'assistants',
  version: 1,
  layout: 'single',
  tables: {
    profiles: domainTable<AssistantProfileId, AssistantProfile>(assistantProfileSchema),
    operations: domainTable<ProvisioningOperationId, ProvisioningOperation>(provisioningOperationSchema),
    conversations: domainTable<AssistantConversationId, AssistantConversation>(assistantConversationSchema),
    teams: domainTable<TeamDefinitionId, TeamDefinition>(teamDefinitionSchema),
    seats: domainTable<TeamSeatId, TeamSeat>(teamSeatSchema),
    adoptions: domainTable<string, InstitutionAdoptionRecord>(institutionAdoptionSchema),
    memory: domainTable<MemoryEntryId, MemoryEntry>(memoryEntrySchema),
  },
})
