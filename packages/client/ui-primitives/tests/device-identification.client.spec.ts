// @vitest-environment jsdom
/** Browser metadata distinguishes tablets from desktop Safari without device-function mocks. */
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals() })

it.each([
  { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5, mobile: true },
  { userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux armv8l', maxTouchPoints: 5, mobile: true },
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 5, mobile: true },
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 1, mobile: false },
  { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64', maxTouchPoints: 5, mobile: false },
])('identifies mobile=$mobile for $platform with $maxTouchPoints touch points', async ({ mobile, ...metadata }) => {
  vi.resetModules()
  vi.stubGlobal('navigator', metadata)
  const { isMobileDevice } = await import('../src/focus.ts')
  expect(isMobileDevice()).toBe(mobile)
  metadata.userAgent = mobile ? 'Desktop browser' : 'Android'
  metadata.platform = mobile ? 'Linux x86_64' : 'MacIntel'
  metadata.maxTouchPoints = mobile ? 0 : 5
  expect(isMobileDevice()).toBe(mobile)
})
