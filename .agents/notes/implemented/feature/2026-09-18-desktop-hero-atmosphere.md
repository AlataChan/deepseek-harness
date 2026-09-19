# Agent Note: octopus_DSH desktop Hero atmosphere

Status: implemented

English | [中文](2026-09-18-desktop-hero-atmosphere.zh.md)

## Problem

octopus_DSH desktop's blank-session Hero is a flat column. A living background has to stay readable over the composer, fade once a transcript exists, honor reduced motion, and stay out of official `apps/desktop`, `dsh-desktop-app`, and desktop-companion product logic. FishLogo stays official.

## Decision

Official [`ui-conversation`](../../../../packages/client/ui-conversation/README.md) declares `conversation.atmosphere` as a root `single` hole. `ConversationRoot` renders it in an absolute, pointer-transparent seat behind header and body (`hero: true` only while the shell is on the blank-session Hero). Official web leaves the hole empty.

The occupant is the private overlay [`@deepseek-ai/dsh-experimental-desktop-hero-atmosphere`](../../../../packages/experimental/desktop-hero-atmosphere/README.md). Its patch inserts one Host row; `dsh.client` discovers the Client face. The Client injects inlined `data:` URLs for the K0 poster, K1 drift still, and six-second GOP loop (`media/poster.jpg`, `media/k1.jpg`, `media/hero.mp4`). The Client-face tsdown `load` hook matches both `src/media-urls.ts` and `lib/types/media-urls.js`; a source-only match leaves CJS `require("url")` in `lib/client.js`. The Client factory never evaluates Node `import.meta.url`. Playback is muted, looping, and `playsInline`. `prefers-reduced-motion: reduce` keeps K0 only. A rejected or CSP-blocked `play()` unmounts the video and leaves the K0/K1 crossfade. Opacity transitions with `hero`. A 48% `bg-base` veil keeps composer contrast.

Seed follows [`scripts/desktop-profile-plugins.json`](../../../../scripts/desktop-profile-plugins.json) (`source: "workspace"`). The overlay is not named by official `desktop-app` or `PROFILE_TEMPLATES.desktop`.

## Alternatives considered

**Paint the atmosphere inside official `dsh-desktop-app` or `apps/desktop`.** Rejected: course and overlay work must not change those product packages.

**Keep a static wallpaper only.** Rejected: the motion brief requires a visible living loop on Hero, not a still that could have been CSS.

**Ship the oil-motion all-intra compile as `hero.mp4`.** Rejected: that artifact is ~18 MB; autonomous playback does not need keyframe-per-frame, and the 355 KB GOP master is the packaged loop.

**Live WebGL / CSS caustics.** Rejected: a baked six-second plate is the display budget the Hero seat can carry, and reduced-motion already has a poster path.

**Reuse the dark aerial-whale still.** Rejected: the plate sits behind input chrome; a busy, low-key image fights contrast.

## Consequences

A seeded octopus_DSH desktop shows the shallow-water plate on the blank-session Hero and hides it on an active transcript. Official web default composition does not occupy `conversation.atmosphere`. A user who removes the bundle name keeps it removed on later seed refresh. The package publishes no `./invariant`: Host apply is empty and Client occupancy is one disposable registration.

## Testing

Package tests cover the inert Host `apply`, packaged media URLs, reduced-motion subscribe/dispose and the `window.matchMedia` default, Client `slots.inject('conversation.atmosphere')`, Hero play with the K1 drift still, reduced-motion K0-only, pause when `hero` is false, and video unmount when `play()` rejects or the video errors. Official `ui-conversation` skeleton tests already require the atmosphere render call.
