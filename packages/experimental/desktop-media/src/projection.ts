/**
 * Fold media session events into one projection.
 * @module @deepseek-ai/dsh-experimental-desktop-media/projection
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { MediaProjectionState, MediaRequestRecord, MediaArtifactRecord } from './types.ts'

const requestSchema = z.object({
  requestId: z.string(),
  kind: z.enum(['video', 'speech', 'composed', 'import']),
  stage: z.enum([
    'proposed', 'approved', 'submitted', 'running', 'downloaded',
    'composed', 'failed', 'stopped', 'pending-recovery',
  ]),
  label: z.string(),
  model: z.string().optional(),
  promptHash: z.string().optional(),
  inputHashes: z.array(z.string()),
  estimatedYuan: z.number(),
  providerTaskId: z.string().optional(),
  jobId: z.string().optional(),
  artifactId: z.string().optional(),
  stopIntent: z.boolean().optional(),
  failure: z.string().optional(),
})

const artifactSchema = z.object({
  artifactId: z.string(),
  requestId: z.string(),
  kind: z.enum(['video', 'speech', 'composed', 'import']),
  name: z.string(),
  file: z.string(),
  digest: z.string(),
  durationSeconds: z.number().optional(),
  sessionId: z.string(),
  workspaceId: z.string().optional(),
  createdAt: z.string(),
})

const stateSchema = z.object({
  requests: z.record(z.string(), requestSchema),
  artifacts: z.record(z.string(), artifactSchema),
}) as unknown as z.ZodType<MediaProjectionState>

/**
 * Empty media projection.
 * @returns empty request and artifact tables.
 */
export function emptyMediaState(): MediaProjectionState {
  return { requests: {}, artifacts: {} }
}

/**
 * Fold one event into media state.
 * @param state - previous state.
 * @param event - committed session event.
 * @returns next state, or the same reference when unused.
 */
export function applyMediaEvent(
  state: MediaProjectionState,
  event: { type: string; data: unknown },
): MediaProjectionState {
  if (event.type === 'media/request') {
    const request = (event.data as { request: MediaRequestRecord }).request
    return {
      ...state,
      requests: { ...state.requests, [request.requestId]: request },
    }
  }
  if (event.type === 'media/approval') {
    const data = event.data as { requestId: string }
    const current = state.requests[data.requestId]
    if (current === undefined) return state
    const next: MediaRequestRecord = { ...current, stage: 'approved' }
    return { ...state, requests: { ...state.requests, [data.requestId]: next } }
  }
  if (event.type === 'media/task') {
    const data = event.data as { requestId: string; providerTaskId: string }
    const current = state.requests[data.requestId]
    if (current === undefined) return state
    const next: MediaRequestRecord = {
      ...current,
      stage: current.stopIntent === true ? current.stage : 'running',
      providerTaskId: data.providerTaskId,
    }
    return { ...state, requests: { ...state.requests, [data.requestId]: next } }
  }
  if (event.type === 'media/artifact') {
    const artifact = (event.data as { artifact: MediaArtifactRecord }).artifact
    const current = state.requests[artifact.requestId]
    const next: MediaRequestRecord | undefined = current === undefined
      ? undefined
      : {
        ...current,
        stage: artifact.kind === 'composed' ? 'composed' : 'downloaded',
        artifactId: artifact.artifactId,
      }
    const requests = next === undefined
      ? state.requests
      : { ...state.requests, [artifact.requestId]: next }
    return {
      requests,
      artifacts: { ...state.artifacts, [artifact.artifactId]: artifact },
    }
  }
  if (event.type === 'media/stop') {
    const data = event.data as { requestId: string }
    const current = state.requests[data.requestId]
    if (current === undefined) return state
    const next: MediaRequestRecord = { ...current, stage: 'stopped', stopIntent: true }
    return { ...state, requests: { ...state.requests, [data.requestId]: next } }
  }
  return state
}

/** Registered media projection. */
export const mediaProjectionDefinition = {
  key: 'media',
  stateVersion: 1,
  stateSchema,
  init: () => emptyMediaState(),
  apply: (state, event) => applyMediaEvent(state, event),
  wire: {
    viewSchema: stateSchema,
    view: state => state,
  },
} satisfies ProjectionDefinition<'media', MediaProjectionState>
