/** Declarative bundle and copied deployment profiles stay resolvable and isolated. */
import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { expect, it } from 'vitest'
import { z } from 'zod'

const root = new URL('../', import.meta.url)
const manifestSchema = z.object({ name: z.string(), version: z.string(), dependencies: z.record(z.string(), z.string()),
  dsh: z.object({ bundle: z.object({ patch: z.string() }) }) })
const manifest = manifestSchema.parse(JSON.parse(readFileSync(new URL('package.json', root), 'utf8')))
const patchSchema = z.array(z.object({ id: z.string().optional(), disabled: z.boolean().optional(),
  insert: z.array(z.object({ id: z.string(), name: z.string(), inject: z.array(z.string()).optional(),
    config: z.record(z.string(), z.unknown()).optional() })).optional() }))

it('mounts only the explicit tenant runtime over the base bundle', () => {
  const patch = patchSchema.parse(load(readFileSync(new URL(manifest.dsh.bundle.patch, root), 'utf8'), { schema: entryListSchema }))
  expect(patch.find(entry => entry.id === 'hmr')?.disabled).toBe(true)
  const entries = patch.flatMap(entry => entry.insert ?? [])
  expect(entries.map(entry => entry.id)).toEqual(['im-runtime'])
  expect(entries[0]?.name).toBe('@deepseek-ai/dsh-experimental-im-feishu/runtime')
  expect(entries[0]?.inject).toEqual(['agents', 'sessions', 'sessionPersistence', 'storage'])
  expect(manifest.dependencies['@deepseek-ai/dsh-experimental-im-feishu']).toBe('workspace:*')
})

it.each(['tenant-a', 'tenant-b', 'ingress'])('declares installed dependencies for the %s example profile', (name) => {
  const profileRoot = new URL(`../../im-feishu/examples/profiles/${name}/`, import.meta.url)
  const profile = z.object({ private: z.literal(true), dependencies: z.record(z.string(), z.string()),
    dsh: z.object({ profile: z.object({ bundles: z.array(z.string()) }) }) })
    .parse(JSON.parse(readFileSync(new URL('package.json', profileRoot), 'utf8')))
  for (const version of Object.values(profile.dependencies)) expect(version).toBe(manifest.version)
  if (name === 'ingress') {
    expect(profile.dsh.profile.bundles).toEqual([])
    const entries = patchSchema.parse(load(readFileSync(new URL('cordis.patch.yml', profileRoot), 'utf8'), { schema: entryListSchema }))
      .flatMap(entry => entry.insert ?? [])
    expect(entries.map(entry => entry.id)).toEqual(['storage', 'im-ingress'])
    for (const entry of entries) {
      const dependency = entry.name.split('/').slice(0, 2).join('/')
      expect(profile.dependencies[dependency]).toBe(manifest.version)
    }
  } else {
    expect(profile.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', manifest.name])
    for (const bundle of profile.dsh.profile.bundles) expect(profile.dependencies[bundle]).toBe(manifest.version)
  }
})
