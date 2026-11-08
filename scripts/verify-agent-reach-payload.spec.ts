import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { verifyReachPayload } from './verify-agent-reach-payload.mjs'
let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(),'reach-payload-'))
  mkdirSync(join(root,'lib'))
  const source = new URL('../packages/experimental/agent-reach/',import.meta.url)
  for (const file of ['package.json','dependency-lock.json','runtime-contract.json']) {
    cpSync(new URL(file,source),join(root,file))
  }
  writeFileSync(join(root,'lib/index.js'),'export {}\n')
  writeFileSync(join(root,'lib/client.js'),'export {}\n')
})
afterEach(() => {rmSync(root,{ recursive:true,force:true })})
it('accepts a dependency-free Host/Client payload', () => {
  expect(verifyReachPayload(root).files).toBe(5)
})
it('rejects an eagerly bundled dependency', () => {
  writeFileSync(join(root,'agent_reach.whl'),'runtime')
  expect(() => verifyReachPayload(root)).toThrow('Eager runtime payload')
})
it('rejects missing frozen dependency manifests', () => {
  rmSync(join(root,'dependency-lock.json'))
  expect(() => verifyReachPayload(root)).toThrow('missing dependency-lock.json')
})
it('rejects automatic package installation scripts', () => {
  const manifest: unknown = JSON.parse(readFileSync(join(root,'package.json'),'utf8'))
  if (typeof manifest !== 'object' || manifest === null) throw new Error('Invalid fixture')
  Object.assign(manifest, { scripts: { postinstall: 'run-dependency-setup' } })
  writeFileSync(join(root,'package.json'),JSON.stringify(manifest))
  expect(() => verifyReachPayload(root)).toThrow('Eager installation lifecycle')
})

it('rejects source-only Python qualification helpers in a desktop seed', () => {
  mkdirSync(join(root, 'scripts'))
  writeFileSync(join(root, 'scripts', 'qualify-lock.py'), 'raise RuntimeError("source helper")\n')
  expect(() => verifyReachPayload(root)).toThrow('Eager runtime payload: qualify-lock.py')
})
