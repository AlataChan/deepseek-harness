# Desktop application icon

`octopus-dsh-icon.png` is the 1024px derivative of the approved right-facing green smiling whale on white in `assets/assistant-brand/workbench-whale.png`. The same image occupies the sidebar and conversation-hero brand slots through the desktop ask-data overlay. The master remains square; derived application icons have rounded corners. Window chrome retains the official `currentColor` `FishLogo`.

Regenerate the embedded brand, five assistant portraits, and PNG / ICNS / multi-size ICO files from the approved originals:

```sh
node scripts/build-assistant-brand-assets.mjs
```

The encoder needs ImageMagick and macOS `iconutil`. The committed ICO supplies Windows builds; no macOS tools run on the Windows builder. `scripts/verify-assistant-brand-assets.mjs` rejects stale macOS bundle icons and missing embedded portraits before DMG assembly.
