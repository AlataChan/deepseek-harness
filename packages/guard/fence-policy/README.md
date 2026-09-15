---
description: "External-data fence policy for users and maintainers configuring structural prompt-injection protection on selected third-party tool results."
kind: "package-reference"
---

# @deepseek-ai/dsh-fence-policy

English | [中文](README.zh.md)

## Summary

`dsh-fence-policy` marks text returned by selected third-party tools as external data. It removes invisible formatting controls, neutralizes structural delimiter and role-marker forms, and wraps each selected text block in `<external-data>` tags. One stable system-prompt section tells the model to treat the enclosed text as data rather than instructions. The policy ships in the `dsh` base bundle and remains available for explicit compositions.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the policy after the tools and system-prompt services. Name every external tool family explicitly and choose a byte limit for text in results that also contain images or other non-text blocks.

```yaml
- name: '@deepseek-ai/dsh-fence-policy'
  config:
    tools: [web_fetch, web_search, 'mcp__*']
    maxMixedTextBytes: 65536
```

| Field | Required | Meaning |
|---|---|---|
| `tools` | Yes | Tool-name patterns; `*` matches any sequence of characters |
| `maxMixedTextBytes` | Yes | Maximum aggregate UTF-8 bytes for fenced text when the result contains a non-text block |

The policy handles only root calls whose names match `tools`. An in-process child agent in the same Cordis composition receives the untagged listener and its own direct root calls are therefore fenced. Calls carrying `exec.parent` are left unchanged.

Plain-text size limits belong to `dsh-spill-policy`: its prepended post-execute listener delegates first, receives the complete fenced result, and then spills or previews it. When any non-text block is present, spill policy does not bound the result, so this package applies `maxMixedTextBytes` while retaining non-text blocks in place.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`sanitizeUntrusted` performs one linear pass without Unicode normalization. It removes specified invisible code points, replaces disallowed C0/C1 controls with spaces, escapes delimiter openers and character-reference ampersands only in structural positions, and escapes line-start role-marker colons. Ordinary comparisons, URL query strings, shell redirections, and natural-language punctuation remain unchanged.

The post-execute listener delegates before transforming a result. It preserves block decisions, explicit `value` replacements, parented calls, nonmatching calls, non-text blocks, and downstream `additionalContexts`. All contributions use Cordis-managed registrations and disappear when the plugin scope is disposed.

| File | Role |
|---|---|
| [`src/escape.ts`](src/escape.ts) | Pure escaping, fencing, and mixed-result truncation |
| [`src/index.ts`](src/index.ts) | Configuration, stable prompt section, and post-execute listener |
| — | No runtime invariant companion is published because the prompt section and result transformation are registrations owned by one plugin scope; there are no independent package observations that can diverge. |

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Stable interpretation section

#### What the model sees

Every request in a mounted composition includes one stable system-prompt section named `guard:external-data`. Each selected result text block is presented in this form:

##### Fenced result

```markdown
<external-data>
<escaped third-party text>
</external-data>
```

#### Token effect

The system section has stable bytes and is added once. Each selected text block adds the two wrapper lines; structural escaping can expand result text by no more than 8×. Plain-text result size remains governed by spill policy, while `maxMixedTextBytes` bounds the aggregate fenced text in mixed results, including wrappers and the truncation suffix.

#### KV Cache effect

The stable system section is reusable across requests with the same composition. Tool results remain append-only conversation content and do not alter earlier request bytes.

## Known Limitations and Deferred Work

- **Forwarded PTC values** — the policy does not track model-authored data flow after a PTC program forwards external values into tool arguments, including a `subagent` prompt.
- **Out-of-process children** — SDK, ACP, Codex, and Claude providers use separate compositions and are not covered.
- **Shell and file channels** — shell input/output and file content are not fenced by this package; protection belongs at their owning ingestion or execution points.
