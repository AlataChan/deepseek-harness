import {fileURLToPath} from 'node:url'
import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-experimental-agent-reach',
  ['lib/types/index.js'],
  { hostPhase: true, lib: {alias: {
    '../runtime-contract.json':fileURLToPath(new URL('./runtime-contract.json', import.meta.url)),
    '../dependency-lock.json':fileURLToPath(new URL('./dependency-lock.json', import.meta.url)),
  }} },
)
