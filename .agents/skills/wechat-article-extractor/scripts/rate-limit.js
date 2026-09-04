/** Local soft rate limit for WeChat article URL fetches (loose defaults). */

const fs = require('fs')
const path = require('path')

/** Max successful URL fetches per rolling hour. */
const MAX_PER_HOUR = 8
/** Minimum gap between URL fetches. */
const MIN_INTERVAL_MS = 20_000
/** Extra cooldown after a platform 1004 / local refusal. */
const COOLDOWN_ON_1004_MS = 15 * 60 * 1000

const STATE_PATH = path.join(__dirname, '..', '.rate-limit-state.json')

/**
 * @typedef {{ timestamps: number[], lastAt: number, cooldownUntil: number }} RateState
 */

/** @returns {RateState} */
function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      timestamps: Array.isArray(parsed.timestamps)
        ? parsed.timestamps.filter(value => typeof value === 'number')
        : [],
      lastAt: typeof parsed.lastAt === 'number' ? parsed.lastAt : 0,
      cooldownUntil: typeof parsed.cooldownUntil === 'number' ? parsed.cooldownUntil : 0,
    }
  } catch {
    return { timestamps: [], lastAt: 0, cooldownUntil: 0 }
  }
}

/** @param {RateState} state */
function saveState(state) {
  try {
    fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch {
    // Best-effort local gate; extraction still returns a friendly error upstream.
  }
}

/**
 * @param {string | null | undefined} url
 * @returns {{ ok: true } | { ok: false, code: number, msg: string }}
 */
function admit(url) {
  // HTML-only extraction does not hit WeChat; do not count it.
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    return { ok: true }
  }

  const now = Date.now()
  const state = loadState()
  const hourAgo = now - 60 * 60 * 1000
  state.timestamps = state.timestamps.filter(ts => ts > hourAgo)

  if (state.cooldownUntil > now) {
    const waitSec = Math.ceil((state.cooldownUntil - now) / 1000)
    return {
      ok: false,
      code: 1004,
      msg: `本地限流：因访问过于频繁，请约 ${waitSec} 秒后再试（避免触发微信 1004）`,
    }
  }

  if (state.lastAt > 0 && now - state.lastAt < MIN_INTERVAL_MS) {
    const waitSec = Math.ceil((MIN_INTERVAL_MS - (now - state.lastAt)) / 1000)
    return {
      ok: false,
      code: 1004,
      msg: `本地限流：两次抓取至少间隔 ${MIN_INTERVAL_MS / 1000} 秒，请约 ${waitSec} 秒后再试`,
    }
  }

  if (state.timestamps.length >= MAX_PER_HOUR) {
    const waitSec = Math.ceil((state.timestamps[0] + 60 * 60 * 1000 - now) / 1000)
    return {
      ok: false,
      code: 1004,
      msg: `本地限流：每小时最多抓取 ${MAX_PER_HOUR} 篇，请约 ${Math.max(waitSec, 1)} 秒后再试`,
    }
  }

  return { ok: true }
}

/**
 * Record a completed URL fetch attempt.
 * @param {string | null | undefined} url
 * @param {{ done?: boolean, code?: number }} result
 */
function after(url, result) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return
  const now = Date.now()
  const state = loadState()
  const hourAgo = now - 60 * 60 * 1000
  state.timestamps = state.timestamps.filter(ts => ts > hourAgo)
  state.lastAt = now
  state.timestamps.push(now)
  if (result && result.code === 1004) {
    state.cooldownUntil = Math.max(state.cooldownUntil, now + COOLDOWN_ON_1004_MS)
  }
  saveState(state)
}

module.exports = {
  admit,
  after,
  MAX_PER_HOUR,
  MIN_INTERVAL_MS,
  COOLDOWN_ON_1004_MS,
}
