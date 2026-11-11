# Get started with Octopus DSH

English | [中文](index.zh.md)

Octopus DSH (Little Green Whale) is this repository's desktop application built on DeepSeek Harness. Choose the desktop installer for the packaged experience or the Web launcher for browser-based use. The [root README](../../../README.md#run) links installation and source setup.

## Open the application

The desktop installer includes Node and the Harness runtime. Open Octopus DSH to reach the home page; first launch does not require selecting Node or a project. Desktop setup and release limitations are described in the [desktop README](../../../apps/desktop/README.md).

For Web use, first start the server through the root README and open the printed URL. A fresh Web UI requires you to add and select a workspace before composing a task. Desktop additions are not automatically enabled in this Web profile.

## Configure a model

Open **Settings → Models**, configure a provider and API key, and save it. The [model configuration guide](./providers.md) covers DeepSeek, other providers, and custom OpenAI-compatible endpoints. Provider usage may incur charges.

## Start a conversation

Select the workspace containing the files you want the agent to use, then start a conversation. In the Web UI, use **Choose workspace** to add and select the project directory. The desktop can initially use your home directory; choose a task-specific workspace when working with project files.

For a first task, send:

> Summarize this repository and identify its main packages.

The agent can read and edit workspace files, run commands, delegate work, and maintain a plan. Operations requiring approval follow the active permission policy.

## Choose a desktop entry

- **Ask data:** select or upload an Excel/CSV source, then start asking about that data.
- **Ask knowledge:** import documents into a library and inspect their conversion status. Model-assisted wiki enrichment requires separate approval; conversion alone does not establish complete knowledge coverage.
- **Assistants and standing teams:** save reusable roles, choose models, and start a task explicitly. Opening a saved roster does not itself run the team. Temporary delegation inside a conversation is a separate capability.
- **Voice and media:** use transcription or request media in a conversation. MiniMax generation needs its own credentials; video composition also needs a user-installed media runtime. See the [media plugin](../../../packages/experimental/desktop-media/README.md) for setup and limitations.

<a id="local-data-and-coexistence"></a>

## Local data and coexistence

Octopus and other DSH installations default to the same Harness home, `~/.dsh`, unless their launch environment supplies a different `DSH_HOME`. Conversations are stored under `$DSH_HOME/sessions`; settings and profiles also use the Harness home. If two installations use this directory, seeing the same history does not mean the conversations were transferred between apps.

A separate app name, executable, or installation folder does not isolate that data. A second desktop companion cannot run against the same home while its lease is held. Before intentionally separating installations, stop their processes and back up the existing home. A newly configured home starts separately and does not automatically migrate history. Desktop knowledge libraries and logs also use Tauri app data; see the [desktop storage reference](../../../apps/desktop/README.md#local-data-and-coexistence) before moving files.

## Continue

- [Configure models](./providers.md)
- [Use the Python SDK](./python-sdk.md)
- [Publish the Web UI behind a reverse proxy](./public-deployments.md)
- [Use other CLI modes](../../../apps/cli/README.md)
- [Develop a plugin](../develop/basic/index.md)
