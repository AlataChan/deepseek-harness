/**
 * System-prompt section for conversation media creation.
 * @module @deepseek-ai/dsh-experimental-desktop-media/prompt
 */

/** Model-facing methods. Shortcuts load this text; they do not submit paid work. */
export const MEDIA_CREATION_PROMPT = [
  'Conversation media creation is available in this session.',
  'Use media_create_video for one short shot. Prefer a 5 second 768P 16:9 pilot.',
  'Pass imported photo artifact ids as imageIds. Use imageMode first_last for two endpoint frames; otherwise they are references. The two modes must not mix.',
  'Ask the user to confirm the proposal before any paid call. A tool flag is not approval.',
  'Use media_synthesize_speech after the user chooses a system voice or a cloned voice.',
  'Use media_clone_voice only after explicit consent that names the speaker.',
  'Use media_compose to join approved clips and replace narration by default.',
  'Report only that the system was asked to open a file. Do not claim playback, inspection, or approval.',
  'Never print API keys, signed URLs, or media bytes.',
].join('\n\n')
