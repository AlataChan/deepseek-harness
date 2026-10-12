/**
 * Real Loader composition: the transcription tool boots from a test-only
 * `cordis.yml` beside the real speech registry and one deterministic stub
 * recognizer, then writes a transcript end to end. Loader and Include are
 * test-only vendor modules, declared as `workspace:~` devDependencies.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as SpeechToTextPlugin from '@deepseek-ai/dsh-experimental-speech-to-text'
import * as plugin from '../src/index.ts'
import * as stubProvider from './fixtures/stub-provider.ts'
import * as stubSubprocess from './fixtures/stub-subprocess.ts'
import * as stubTools from './fixtures/stub-tools.ts'
import { wave } from './wav.ts'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  context = undefined
  root = undefined
  stubTools.registered.length = 0
})

it('boots from cordis.yml and writes a transcript through the real speech registry', async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-speech-transcribe-composition-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: speech-to-text',
    "  name: '@deepseek-ai/dsh-experimental-speech-to-text'",
    '  config:',
    '    defaultProvider: stub-local',
    '    language: auto',
    '- id: stub-tools',
    "  name: './stub-tools.ts'",
    '- id: stub-subprocess',
    "  name: './stub-subprocess.ts'",
    '- id: stub-provider',
    "  name: './stub-provider.ts'",
    '- id: speech-transcribe',
    "  name: '@deepseek-ai/dsh-experimental-desktop-speech-transcribe'",
    '  config:',
    '    maxAudioMinutes: 120',
  ].join('\n') + '\n')

  const ctx = context = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-experimental-speech-to-text', SpeechToTextPlugin],
    ['@deepseek-ai/dsh-experimental-desktop-speech-transcribe', plugin],
    ['./stub-tools.ts', stubTools],
    ['./stub-subprocess.ts', stubSubprocess],
    ['./stub-provider.ts', stubProvider],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string): Promise<unknown> {
      if (!modules.has(specifier)) throw new Error(`Unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as never
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()

  const definition = stubTools.registered[0]
  if (definition === undefined) throw new Error('the composed plugin registered no tool')
  expect(definition.name).toBe('speech_transcribe')

  const audioPath = join(root, 'composed.wav')
  await writeFile(audioPath, wave(1))
  const value = await definition.execute(
    { audioPath },
    { signal: new AbortController().signal } as never,
  ) as { transcriptPath?: string; characters?: number; preview?: string }

  const transcriptPath = join(root, 'composed.transcript.md')
  expect(value.transcriptPath).toBe(transcriptPath)
  expect(value.characters).toBe(stubProvider.RESULT.text.length)
  expect(value.preview).toBe(stubProvider.RESULT.text)
  const content = await readFile(transcriptPath, 'utf8')
  expect(content).toContain('# composed.wav 录音转写')
  expect(content).toContain('- 识别服务：stub-local（Stub Recognizer）')
  expect(content).toContain(stubProvider.RESULT.text)
})
