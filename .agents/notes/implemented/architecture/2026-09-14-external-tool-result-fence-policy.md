# Agent Note: External tool-result fencing uses targeted structural escaping

Status: implemented

English | [中文](2026-09-14-external-tool-result-fence-policy.zh.md)

## Problem

Third-party tool results can contain text that imitates system delimiters, message roles, or encoded delimiters. Passing that text to the model without an interpretation marker allows external content to compete with harness instructions. Escaping every punctuation character would damage code, URLs, shell examples, and ordinary language, while one unbounded transformation could also bypass the existing tool-result spill policy.

## Decision

`dsh-fence-policy` applies one non-normalizing linear scan to configured root tool-result text. It removes a fixed set of invisible formatting code points, replaces disallowed controls, and escapes only delimiter openers, character-reference ampersands, and line-start role colons in structural positions. A fixed compatibility-code-point table makes the security-sensitive confusable set reviewable and testable against the runtime's NFKC data.

Each transformed text block receives a closed `<external-data>` fence. One stable `guard:external-data` system-prompt section tells the model that fenced text is data rather than instructions, at the centrally allocated `SECTION_ORDERS.EXTERNAL_DATA` position 700. Web tools return their rendered text without a per-result untrusted-content notice, so this section is the single interpretation notice.

The `dsh` base bundle mounts fence policy directly after spill policy with `tools: [web_fetch, web_search, 'mcp__*', ask_knowledge_retrieve, ask_knowledge_lookup, run_code]` and `maxMixedTextBytes: 50000`, equal to spill policy's `maxInlineBytes`. The post-execute listener delegates first and preserves blocking decisions, explicit value replacements, parented calls, non-text blocks, and downstream contexts. `run_code` is fenced at the root because PTC sub-dispatch values reach the model only through that root result. Untagged scope delivery covers direct root calls made by same-composition in-process child agents; model-authored forwarding into arguments and out-of-process compositions remain outside this policy.

Size ownership follows result type. `dsh-spill-policy` bounds the complete fenced plain-text result because its prepended listener receives the fence policy's downstream transformation. Spill policy skips mixed results, so fence policy alone caps the aggregate UTF-8 bytes of their fenced text while retaining non-text blocks. A cap too small for one fence and truncation suffix removes every text block.

## Alternatives considered

**Normalize all input before matching.** Rejected because normalization changes ordinary third-party content and makes byte fidelity impossible to explain; fixed compatibility lookup detects the relevant confusables without rewriting the returned data.

**Escape every angle bracket and ampersand.** Rejected because it corrupts comparisons, redirects, URL query strings, and code that does not form a structural marker.

**Give fence policy one cap for every result.** Rejected because it would duplicate spill policy for plain text and could truncate before the spill store records the complete fenced result.

**Use a pattern blacklist sanitizer.** Rejected because enumerating tag spellings, punctuation variants, and nested closing markers is incomplete; structural escaping neutralizes delimiter forms without enumerating them.

**Put an untrusted-content notice in each tool result.** Rejected because one interpretation rule would live in several tools, while MCP and Ask Knowledge results had no equivalent notice.

**Add a trust flag to `ToolDefinition`.** Rejected because it changes the core tools contract for a policy that a post-execute listener already expresses.

**Rewrite parented PTC values or block forwarding into `subagent` prompts.** Rejected because every forwarding channel, including tool arguments, files, and shell, is model-authored data flow; blocking one channel adds state without closing the class.

## Consequences

Configured third-party result text is visibly delimited and common structural prompt-injection forms are neutralized without changing ordinary code-like text. Plain text keeps the existing spill and retrieval behavior, while mixed text has an explicit deployment cap. The stable section changes the system-prompt bytes once when a composition first includes the policy, establishing a new reusable KV-cache prefix. Web and root `run_code` result bytes contain the fence, and web results use that fence instead of a per-result notice prefix.

The guarantee is deliberately channel-specific: shell, file, forwarded tool-argument, and out-of-process child content need protections owned by those paths. The fixed Unicode table and structural recognizers require exhaustive code-point, fidelity, adversarial-size, disposal, and real-composition tests whenever they change.
