# Desktop application icon

`octopus-dsh-icon.png` is the 1024px derivative of the approved right-facing green refined original leaf-whale on white in `assets/assistant-brand/original-whale-refined.png`. This is also the default sidebar and conversation-hero mark; the desktop ask-data overlay offers three in-app presets without changing system icons. The master remains square; derived application icons have rounded corners. Window chrome retains the official `currentColor` `FishLogo`.

Regenerate the three embedded brand presets, five assistant portraits, and PNG / ICNS / multi-size ICO files from the approved originals:

```sh
node scripts/build-assistant-brand-assets.mjs
```

Use `--brands-only` when changing product marks to preserve the existing portrait encodings. The encoder needs ImageMagick and macOS `iconutil`. The committed ICO supplies Windows builds; no macOS tools run on the Windows builder. `scripts/verify-assistant-brand-assets.mjs` rejects stale macOS bundle icons and missing embedded portraits before DMG assembly.
