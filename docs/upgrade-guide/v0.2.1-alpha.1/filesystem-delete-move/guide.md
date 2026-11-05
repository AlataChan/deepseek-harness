---
kind: upgrade-guide
description: "FileSystem implementers must add deleteFile and moveFile, and apply_patch stays off unless a composition sets applyPatch."
---

# Filesystem delete and move

English | [中文](guide.zh.md)

## Change

`FileSystem` now requires `deleteFile` and `moveFile`. `deleteFile` removes one regular file. `moveFile` publishes the source, or caller-supplied replacement text, at the destination and then removes the source. Identical paths report `FS_SAME_TARGET`. A destination that was published while the source remains is a finished outcome with `sourceDeleted: false`; it is not rolled back.

`fs/delete-intent` is the observation guard for deletion. Edit and move-source still use `fs/edit-intent`. The destination uses `fs/write-intent`. Shipped base, headless, desktop, standard, and persistent-question compositions keep `fs-observation-policy` enabled and leave `tool-fs` `applyPatch` false, so `apply_patch` stays unregistered until a deployment sets `applyPatch: true`.

A multi-file patch is still not one transaction. `apply_patch` refuses a symbolic-link source or destination before any write, and an update or move keeps an existing file's CRLF endings. If the caller cancels after a write, the aborted result still names that path and the operations that did not run. Session logs do not change format for this seam.

## Migration

1. On every class that extends `FileSystem`, implement `deleteFile` and `moveFile` with the signatures in `@deepseek-ai/dsh-fs`. A sandboxing backend must fence every path before it delegates. An SSH helper must accept `fs.delete` and `fs.move`.
2. Keep `applyPatch` false unless that deployment should expose `apply_patch`. Do not set `disabled: true` on `fs-observation-policy`.
3. Confirm a delete removes only a regular file that was read, a move onto an unread existing file changes nothing, and a failed source removal leaves the new destination in place and says so. No Session log rewrite is required.
