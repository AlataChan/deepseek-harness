import { describe, expect, it } from 'vitest'
import {
  buildSafeArgv,
  decodeRuntimeContract,
  findChannel,
  RUNTIME_CONTRACT,
  validateConfig,
  validateRoute,
} from '../src/catalog.ts'

describe('Agent-Reach Catalog and Route Validation', () => {
  it('freezes the upstream metadata and candidate revision', () => {
    expect(RUNTIME_CONTRACT.upstream.version).toBe('1.6.1')
    expect(RUNTIME_CONTRACT.upstream.reviewedRevision).toBe('c70ae6da5d39bc90e09ad2ae0575ccc89f31e284')
    expect(RUNTIME_CONTRACT.upstream.schemaVersion).toBe(1)
    expect(RUNTIME_CONTRACT.channels.length).toBe(14)
  })

  it('verifies exact upstream channel actions match candidate CLI', () => {
    const twitter = findChannel('twitter')
    expect(twitter?.actions.map(a => a.name)).toEqual(['search', 'profile', 'tweets', 'thread'])

    const reddit = findChannel('reddit')
    expect(reddit?.actions.map(a => a.name)).toEqual(['search', 'read', 'subreddit'])

    const linkedin = findChannel('linkedin')
    expect(linkedin?.actions.map(a => a.name)).toEqual(['jobs', 'read'])

    const v2ex = findChannel('v2ex')
    expect(v2ex?.actions.map(a => a.name)).toEqual(['hot', 'node', 'read', 'user'])

    const web = findChannel('web')
    expect(web?.actions.map(a => a.name)).toEqual(['search', 'read'])
  })

  it('rejects unknown channels and unknown actions', () => {
    const unknownChannel = validateRoute('unknown_chan', 'read')
    expect(unknownChannel.ok).toBe(false)
    if (!unknownChannel.ok) {
      expect(unknownChannel.code).toBe('UNKNOWN_CHANNEL')
    }

    const unknownAction = validateRoute('bilibili', 'nonexistent_action')
    expect(unknownAction.ok).toBe(false)
    if (!unknownAction.ok) {
      expect(unknownAction.code).toBe('UNKNOWN_ACTION')
    }
  })

  it('rejects excluded actions such as transcription', () => {
    const res = validateRoute('youtube', 'transcribe')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('ACTION_EXCLUDED')
    }
  })

  it('rejects management operations called as query routes', () => {
    const res1 = validateRoute('doctor', 'check')
    expect(res1.ok).toBe(false)
    if (!res1.ok) {
      expect(res1.code).toBe('ACTION_EXCLUDED')
    }

    const res2 = validateRoute('bilibili', 'setup')
    expect(res2.ok).toBe(false)
    if (!res2.ok) {
      expect(res2.code).toBe('ACTION_EXCLUDED')
    }
  })

  it('rejects disabled channels by default', () => {
    // boss is optional, not in default enabledChannels: ['bilibili', 'youtube', 'v2ex']
    const res = validateRoute('boss', 'read')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('CHANNEL_DISABLED')
    }
  })

  it('rejects experimental channels when allowExperimentalChannels is false', () => {
    const cfg = {
      enabledChannels: ['twitter', 'bilibili'],
      allowExperimentalChannels: false,
    }
    const res = validateRoute('twitter', 'search', undefined, cfg)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('EXPERIMENTAL_CHANNEL_DISABLED')
    }
  })

  it('blocks Bilibili subtitle by default when sessionAccessRoutes is empty', () => {
    const res = validateRoute('bilibili', 'subtitle')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('SESSION_ROUTE_FORBIDDEN')
      expect(res.message).toContain('bilibili/subtitle/bili-cli')
    }
  })

  it('blocks Boss native backend boss-agent-cli when sessionAccessRoutes is empty', () => {
    // boss-agent-cli invokes require_boss_cdp which prepares session reuse and may open browser.
    // It must NOT bypass opt-in even when explicitly selected.
    const res = validateRoute('boss', 'read', 'boss-agent-cli', {
      enabledChannels: ['boss'],
      sessionAccessRoutes: [],
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('SESSION_ROUTE_FORBIDDEN')
      expect(res.message).toContain('boss/read/boss-agent-cli')
    }
  })

  it('permits Bilibili subtitle only when explicitly opted in via sessionAccessRoutes', () => {
    const cfg = {
      enabledChannels: ['bilibili'],
      sessionAccessRoutes: ['bilibili/subtitle/bili-cli'],
    }
    const res = validateRoute('bilibili', 'subtitle', undefined, cfg)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.requiredEffects).toContain('cookie-import')
      expect(res.requiredEffects).toContain('connected-browser-discovery')
      expect(res.requiredEffects).toContain('native-credential-write')
    }
  })

  it('rejects wildcards in sessionAccessRoutes configuration', () => {
    const badCfg1 = { sessionAccessRoutes: ['bilibili/*'] }
    expect(validateConfig(badCfg1).valid).toBe(false)

    const badCfg2 = { sessionAccessRoutes: ['*/*/*'] }
    expect(validateConfig(badCfg2).valid).toBe(false)

    const routeRes = validateRoute('bilibili', 'subtitle', undefined, badCfg1)
    expect(routeRes.ok).toBe(false)
    if (!routeRes.ok) {
      expect(routeRes.code).toBe('INVALID_CONFIG')
    }
  })

  it('fails closed when decoding invalid side effects or corrupt contract', () => {
    expect(() =>
      decodeRuntimeContract({
        upstream: { version: '1.6.1', reviewedRevision: 'abc', schemaVersion: 1, repository: '', localCandidateCheckout: '' },
        channels: [
          {
            name: 'fake',
            description: 'fake',
            level: 'default',
            actions: [
              {
                name: 'act',
                help: 'help',
                params: [],
                backends: [{ name: 'b', sideEffects: ['fabricated-effect'] }],
              },
            ],
          },
        ],
      }),
    ).toThrow(/Unknown or invalid side effect "fabricated-effect"/)
  })

  it('buildSafeArgv emits required params as positionals after -- and optional as flags before --', () => {
    const built = buildSafeArgv({
      channel: 'youtube',
      action: 'search',
      params: { query: '--help; rm -rf /', limit: 3 },
      timeoutSeconds: 30,
    })
    expect(built.ok).toBe(true)
    if (built.ok) {
      expect(built.argv).toEqual([
        'youtube',
        'search',
        '--timeout',
        '30',
        '--limit',
        '3',
        '--',
        '--help; rm -rf /',
      ])
    }
  })

  it('buildSafeArgv enforces strict typing, integer limits, and rejects unknown params', () => {
    // Unknown parameter rejection
    const unknownParam = buildSafeArgv({
      channel: 'youtube',
      action: 'search',
      params: { query: 'test', extra_injected_key: 'malicious' },
    })
    expect(unknownParam.ok).toBe(false)
    if (!unknownParam.ok) {
      expect(unknownParam.error).toContain('Unrecognized parameter "extra_injected_key"')
    }

    // Bool as number rejection
    const boolAsNum = buildSafeArgv({
      channel: 'youtube',
      action: 'search',
      params: { query: 'test', limit: true },
    })
    expect(boolAsNum.ok).toBe(false)
    if (!boolAsNum.ok) {
      expect(boolAsNum.error).toContain('must be a finite number')
    }

    // Fractional number rejection for integer limit
    const fractionalNum = buildSafeArgv({
      channel: 'youtube',
      action: 'search',
      params: { query: 'test', limit: 2.5 },
    })
    expect(fractionalNum.ok).toBe(false)
    if (!fractionalNum.ok) {
      expect(fractionalNum.error).toContain('must be an integer')
    }

    // Out of bound number rejection
    const outOfBounds = buildSafeArgv({
      channel: 'youtube',
      action: 'search',
      params: { query: 'test', limit: 0 },
    })
    expect(outOfBounds.ok).toBe(false)

    // Non-string for string rejection
    const nonString = buildSafeArgv({
      channel: 'youtube',
      action: 'search',
      params: { query: 12345 },
    })
    expect(nonString.ok).toBe(false)
    if (!nonString.ok) {
      expect(nonString.error).toContain('must be a string')
    }
  })

  it('strictly validates configuration bounds rejecting NaN, zero concurrency and bad types', () => {
    expect(validateConfig({ queryTimeoutMs: NaN }).valid).toBe(false)
    expect(validateConfig({ maxConcurrentQueries: 0 }).valid).toBe(false)
    expect(validateConfig({ setupTimeoutMs: 500 }).valid).toBe(false)
    expect(validateConfig({ maxStdoutBytes: 500 }).valid).toBe(false)
    expect(validateConfig({ terminateGraceMs: 50 }).valid).toBe(false)
    expect(validateConfig({ enabledChannels: ['unknown_channel'] }).valid).toBe(false)
  })
})

it('rejects malformed deployment values at the configuration parser', () => {
  // @ts-expect-error Configuration JSON is untyped before validation.
  expect(validateConfig({ runtimeOverride: 12 }).valid).toBe(false)
  expect(validateConfig({ runtimeOverride: 'relative' }).valid).toBe(false)
  // @ts-expect-error Configuration JSON is untyped before validation.
  expect(validateConfig({ sessionAccessRoutes: 'bilibili/read/bili-cli' }).valid).toBe(false)
  // @ts-expect-error Configuration JSON is untyped before validation.
  expect(validateConfig({ sessionAccessRoutes: [12] }).valid).toBe(false)
  for (const route of ['a/b', '/read/bili-cli', 'bilibili//bili-cli', 'bilibili/read/', 'absent/read/cli', 'bilibili/absent/bili-cli', 'bilibili/read/absent']) {
    expect(validateConfig({ sessionAccessRoutes: [route] }).valid).toBe(false)
  }
  // @ts-expect-error Configuration JSON is untyped before validation.
  expect(validateConfig({ enabledChannels: 'v2ex' }).valid).toBe(false)
  // @ts-expect-error Configuration JSON is untyped before validation.
  expect(validateConfig({ allowExperimentalChannels: 'true' }).valid).toBe(false)
  expect(validateConfig({ runtimeOverride: '/tmp/qualified-cli', enabledChannels: [], sessionAccessRoutes: [] }).valid).toBe(true)
})

it('rejects unknown argv routes and invalid deadlines before encoding parameters', () => {
  expect(buildSafeArgv({ channel: 'absent', action: 'read', params: {} }).ok).toBe(false)
  expect(buildSafeArgv({ channel: 'v2ex', action: 'absent', params: {} }).ok).toBe(false)
  for (const timeoutSeconds of [0, -1, NaN, Infinity]) {
    expect(buildSafeArgv({ channel: 'v2ex', action: 'hot', params: {}, timeoutSeconds }).ok).toBe(false)
  }
  expect(validateRoute('bilibili', 'read', 'absent').ok).toBe(false)
})

it('decodes optional catalog metadata without requiring descriptions from another version', () => {
  const decoded = decodeRuntimeContract({ upstream: { version: '1.6.1', reviewedRevision: 'fixture', schemaVersion: 1 }, channels: [
    { name: 'v2ex', description: 'Public topics', level: 'default', actions: [{ name: 'hot', help: 'Public hot topics', params: [], backends: [] }] },
  ] })
  expect(decoded.defaultConfiguration).toEqual({})
  expect(decoded.managementCommands).toEqual([])
  expect(decoded.excludedActions).toEqual([])
  expect(decoded.channels[0]?.actions[0]?.usage).toBeUndefined()
  expect(decoded.channels[0]?.actions[0]?.publicWeb).toBeUndefined()
})

it('rejects question-mark route wildcards and nonnumeric or excessive configuration limits', () => {
  expect(validateConfig({ sessionAccessRoutes: ['bilibili/read/bili-cli?'] }).valid).toBe(false)
  // @ts-expect-error This exercises untyped configuration JSON at the parser.
  expect(validateConfig({ queryTimeoutMs: 'fast' }).valid).toBe(false)
  expect(validateConfig({ queryTimeoutMs: 1e20 }).valid).toBe(false)
})
