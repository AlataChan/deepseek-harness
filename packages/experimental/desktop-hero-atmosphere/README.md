---
description: "octopus_DSH desktop blank-session Hero atmosphere: a baked shallow-water loop behind conversation chrome, for users composing the desktop profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-hero-atmosphere

English | [中文](README.zh.md)

## Summary

This overlay occupies the official `conversation.atmosphere` hole with a packaged 16:9 shallow-water loop on the blank-session Hero. The plate fades out when the shell leaves Hero, keeps a K0/K1 crossfade when `prefers-reduced-motion` is reduce or the video element cannot play, and never captures pointer events. Official `dsh-desktop-app` and `PROFILE_TEMPLATES.desktop` do not name this package. The desktop profile seed copies the built tree (`source: "workspace"` in [scripts/desktop-profile-plugins.json](../../../scripts/desktop-profile-plugins.json)).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

octopus_DSH desktop seeds this package from [scripts/desktop-profile-plugins.json](../../../scripts/desktop-profile-plugins.json). The Host export is inert. The Client half registers after `ui-conversation` declares `conversation.atmosphere`. Removing the pin from that roster (or deleting the seeded bundle name) leaves the official hole empty; FishLogo and composer chrome stay official.

### What you get

On a blank-session Hero the conversation column shows a high-key sandbar still plus a six-second caustic loop, veiled so input remains readable. An active transcript sets `hero: false` and the plate opacity goes to zero. Reduced-motion users see only K0. A failed or CSP-blocked `HTMLVideoElement.play()` leaves the K0/K1 crossfade. The Client bundle inlines those files as `data:` URLs.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`cordis.patch.yml` inserts one Host row. `dsh.client` discovers the Client face after that fiber is live. The Host `apply` is empty; the Client `apply` calls `ctx.slots.inject('conversation.atmosphere', …)` with inlined `media/poster.jpg`, `media/k1.jpg`, and `media/hero.mp4`. Playback is autonomous (`muted` / `loop` / `playsInline`). Official `ConversationRoot` owns the absolute column seat and passes `hero`.

No `./invariant` companion is published. The Host apply is empty, and Client occupancy is one disposable slot registration whose absence is an empty atmosphere hole; there is no independently observable owned relationship that can diverge.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Dual-face Host insert |
| [`src/index.ts`](src/index.ts) | Inert Host entry |
| [`src/client/index.ts`](src/client/index.ts) | Slot occupant |
| [`src/client/HeroAtmosphere.tsx`](src/client/HeroAtmosphere.tsx) | Poster, drift still, loop, veil, fade |
| [`media/`](media/) | Packaged K0/K1 stills and GOP loop |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Conversation UI](../../client/ui-conversation/README.md) — official `conversation.atmosphere` hole and Hero phase.
- [Web Client Slots](../../../docs/subsystems/slots.md) — slot hierarchy.
- [Experimental packages](../README.md) — incubation status and release exclusion.

-----

<a id="model-experience"></a>
## Model Experience

None, as this overlay paints a decorative conversation-column plate; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Hero only** — the plate is decorative and hidden once a transcript is active; it is not a session wallpaper.
- **No official desktop-app composition change** — this overlay is a profile pin.
- **Autonomous playback only** — the loop does not scrub or follow scroll.
- **Desktop CSP has no `media-src`** — the official WebView falls back to `default-src 'self'`, so a `data:` or remote `<video>` does not play. The plate keeps the inlined K0/K1 crossfade.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
