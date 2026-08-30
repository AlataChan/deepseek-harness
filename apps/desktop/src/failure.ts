/** User-facing copy for desktop resolve and handshake failures. */

/** Headline and supporting line shown on home and in Settings. */
export interface DesktopFailureCopy {
  /** One sentence the user can act on. */
  headline: string
  /** Extra context; omit internals when the headline is enough. */
  detail: string
}

/**
 * Translate a resolve or handshake failure into product copy.
 * @param reason - raw shell or CLI message.
 * @returns headline and optional detail for home and Settings.
 */
export function describeDesktopFailure(reason: string): DesktopFailureCopy {
  if (/dsh\.companions\.desktop/u.test(reason)) {
    return {
      headline: 'The Harness on PATH cannot open a desktop session.',
      detail: 'A source-built app uses this repository automatically. Build the CLI in this checkout if this message remains.',
    }
  }
  if (/companion entry is missing/u.test(reason)) {
    return {
      headline: 'This repository is not built yet.',
      detail: 'Build the desktop companion in this checkout, then try New session again.',
    }
  }
  if (/Node executable was not found/u.test(reason)) {
    return {
      headline: 'Node.js was not found.',
      detail: 'Install Node.js 22.19 or newer so a real node executable is on PATH.',
    }
  }
  if (/workspaceRoot is not configured/u.test(reason)) {
    return {
      headline: 'No workspace folder is set.',
      detail: 'Choose the folder this window should work in.',
    }
  }
  const stripped = reason
    .replace(/^installed-runtime CLI failed:\s*/u, '')
    .replace(/\s*\(exit \d+\)\s*$/u, '')
  return {
    headline: 'This window could not start a session.',
    detail: stripped,
  }
}
