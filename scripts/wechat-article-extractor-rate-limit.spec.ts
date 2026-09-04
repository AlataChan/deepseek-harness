/**
 * Soft rate-limit checks for the shipped wechat-article-extractor skill (no network).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const repoRoot = join(import.meta.dirname, '..')
const skillRoot = join(repoRoot, '.agents/skills/wechat-article-extractor')
const statePath = join(skillRoot, '.rate-limit-state.json')
const rateLimitPath = join(skillRoot, 'scripts/rate-limit.js')

function loadRateLimit(): {
  admit: (url: string | null | undefined) => { ok: boolean; code?: number; msg?: string }
  after: (url: string | null | undefined, result: { done?: boolean; code?: number }) => void
} {
  const resolved = require.resolve(rateLimitPath)
  if (require.cache[resolved] !== undefined) {
    Reflect.deleteProperty(require.cache, resolved)
  }
  return require(rateLimitPath)
}

describe('wechat-article-extractor rate limit', () => {
  let backup: string | undefined

  beforeEach(() => {
    backup = existsSync(statePath) ? readFileSync(statePath, 'utf8') : undefined
    if (existsSync(statePath)) rmSync(statePath)
  })

  afterEach(() => {
    if (backup === undefined) {
      if (existsSync(statePath)) rmSync(statePath)
    } else {
      writeFileSync(statePath, backup)
    }
    const resolved = require.resolve(rateLimitPath)
    if (require.cache[resolved] !== undefined) {
      Reflect.deleteProperty(require.cache, resolved)
    }
  })

  it('allows non-URL inputs without counting', () => {
    const rateLimit = loadRateLimit()
    expect(rateLimit.admit(null).ok).toBe(true)
    expect(rateLimit.admit(undefined).ok).toBe(true)
  })

  it('enforces minimum interval between URL fetches', () => {
    const rateLimit = loadRateLimit()
    const url = 'https://mp.weixin.qq.com/s?__biz=test'
    expect(rateLimit.admit(url).ok).toBe(true)
    rateLimit.after(url, { done: true, code: 0 })
    const blocked = rateLimit.admit(url)
    expect(blocked.ok).toBe(false)
    expect(blocked.code).toBe(1004)
    expect(String(blocked.msg)).toMatch(/间隔/)
  })

  it('starts a cooldown after a 1004 result', () => {
    writeFileSync(statePath, JSON.stringify({
      timestamps: [],
      lastAt: Date.now() - 60_000,
      cooldownUntil: 0,
    }))
    const rateLimit = loadRateLimit()
    const url = 'https://mp.weixin.qq.com/s?__biz=cooldown'
    expect(rateLimit.admit(url).ok).toBe(true)
    rateLimit.after(url, { done: false, code: 1004 })
    const blocked = rateLimit.admit(url)
    expect(blocked.ok).toBe(false)
    expect(String(blocked.msg)).toMatch(/本地限流/)
  })
})
