---
kind: upgrade-guide
description: "Execution tools use an effective Session directory while persisted workspaces retain their original identity."
---

# Session execution directory

English | [中文](guide.zh.md)

## Change

Relative filesystem, shell, LSP, skill, instruction, present, PTC and hook operations resolve from the effective directory. Session header.cwd, sandbox workspaceRoot, navigation, data/knowledge bindings, Feishu authorization, commerce/media files and Team preview keep the original project. New working-directory/change and worktree/record events are required on read. Existing shells retain their starting directory.

## Migration

1. Custom compositions that mount execution consumers must also mount dsh-working-directory with filesystem, session-projection and system-prompt services. Mount dsh-tool-working-directory to expose the directory tool.
2. Keep header.cwd and sandbox workspaceRoot set to the original project. Use ctx.workingDirectory.ensure(agent, signal) for execution and set(agent, path, signal) for explicit switches.
3. Confirm a new command uses the selected checkout while navigation and authorization still use the original project. Use the Changes tab to return or restore. Do not downgrade logs containing the new required events to builds that do not declare them. Existing format generations remain in place.
