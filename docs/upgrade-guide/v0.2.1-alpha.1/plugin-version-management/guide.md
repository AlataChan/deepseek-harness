---
kind: upgrade-guide
description: Plugin management clients gain explicit version remotes and a required updatable inventory field.
---

# Plugin version management

English | [中文](guide.zh.md)

## Change

Plugin Manager adds `listVersions` and `updateBundle`, and bundle inventory includes `updatable`. Existing clients that construct `BundleInfo` records must provide this boolean. The current Plugins page offers a user-requested version check and confirms a selected update. Distribution-pinned packages remain locked. No background checks or automatic updates run.

## Migration

1. Update custom `BundleInfo` producers and fixtures to supply `updatable`; derive it from the Host's inventory rather than enabling controls for pinned packages.
2. Regenerate clients of the Plugin Manager remotes. Subscribe to `plugin-manager/update-state` if displaying progress, and retain `result` and `restore` separately.
3. Supply distribution-pinned package names through `plugin-manager` config `lockedBundles`. Keep this list when replacing its config.
4. Verify that opening Plugins does not check versions, that a locked package has no Versions section, and that a confirmed eligible update displays its outcome. Without HMR, restart the profile after the next-start notice.
