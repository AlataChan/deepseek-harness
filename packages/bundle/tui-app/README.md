# `@deepseek-ai/dsh-tui-app`

English | [中文](README.zh.md)

`dsh-tui-app` is the shipped patch layer for the interactive terminal profile. It composes directly over [`dsh-base`](../base/README.md), starts [`dsh-tui`](../../ui/tui/README.md) in the Host process, and adds no Host gateway, Client runtime, browser transport, IPC carrier, or network listener.

## Composition

The patch disables the shared HMR row, selects the deployment tool-presentation mode, adds the worker-thread code runtime, and mounts `tui-startup` before the TUI row. The startup provider parses the application-owned `--resume` and initial-task arguments; the TUI row receives that value through lazy Cordis config and never reads global argv.

This bundle deliberately excludes `dsh-client-app`: Ink consumes Agent, Session, command, approval, question, and tool-presentation APIs directly in the same Cordis tree. The invariant service and the `dsh-tui` and `dsh-tui-app` companions check the live controller's Agent, interaction-provider, and startup-provider relationships.

## Model Experience

The bundle supplies the terminal deployment persona: the coding agent receives its model, working directory, and the fact that the user is interacting through the `dsh` terminal client. Tool schemas and all other model-visible content come from `dsh-base` and the selected tool-presentation mode.

#### KV Cache effect

The terminal persona replaces the base package's empty persona at the stable first prompt position. The bundle does not add a transport-specific model request layer.

## Limitations

- The profile requires interactive stdin and stdout; use the headless profile through `dsh exec` for automation.
- The bundle owns Node terminal composition only. A future desktop shell is a separate carrier over shared application state, not part of this profile.
