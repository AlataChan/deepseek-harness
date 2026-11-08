---
description: "Read supported platforms with the bundled Agent-Reach plugin and install prerequisites only when needed."
---

# Read platform content

English | [中文](agent-reach.zh.md)

Octopus includes the lightweight Agent-Reach plugin. Start in an ordinary conversation or a Team conversation; there is no extra media agent to create.

1. Ask to inspect a V2EX topic, a Bilibili video or YouTube subtitle information. The assistant can discover supported actions first.
2. If dependencies are missing, ask it to prepare the environment. Review the exact versions, destination and licenses in the installation confirmation. Rejecting leaves Octopus usable.
3. After installation succeeds, repeat the intended query. Future reads reuse the installed runtime.

Installation always asks for confirmation, even in full-access mode. It installs a private runtime and fixed dependencies; it does not change your system Python, Node or login state. No dependency is downloaded simply by opening Octopus. Platform access can still be blocked or require login after installation.

## Browser sessions and login

Bilibili subtitles are blocked by default because their upstream action can import an existing browser session and write credentials. An administrator must explicitly permit that exact action/backend in plugin configuration. Installing dependencies does not grant this permission. Browser-launch backends remain unavailable pending ownership qualification. Never paste passwords or cookies into a conversation.

Public excerpts, loaded comments and subtitle-track lists can be partial. Check the result's completeness label and source links. A login wall or rate limit is a reported result, not a reason to switch accounts automatically.

## Turn off or clean up

Use Plugins to disable the bundle; your choice survives seed refresh. An administrator can set `enableSetupTool: false` to preserve read tools while hiding installation.

Disabling stops active work but preserves runtime and account data. To remove downloaded runtime files, stop the plugin and remove only `<DSH_HOME>/runtimes/agent-reach`. This does not remove upstream account state in `~/.agent-reach`. Inspect an interrupted `.setup.lock` before removing it; do not delete one while installation is running.

Manual deployments can install the separately packed bundle with the normal DSH plugin command. An external runtime requires an explicit absolute administrator override and qualification; do not install the unrelated similarly named PyPI package. [Package details](../../../packages/experimental/agent-reach/README.md) own configuration, process limits and runtime records.
