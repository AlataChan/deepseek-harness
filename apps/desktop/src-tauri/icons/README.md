# Desktop dock icon

`octopus-dsh-icon.png` is the 1024px source. It is an original whale-and-leaf mark for octopus_DSH: forest green on plate `#F4F7F3`. It does not reuse the official DeepSeek fish path.

Window chrome still uses the official `currentColor` `FishLogo`. Do not bake macOS squircle corners into the source.

Regenerate raster icons:

```sh
bash apps/desktop/src-tauri/icons/render.sh
```
