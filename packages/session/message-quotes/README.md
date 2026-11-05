---
description: "Quote selected transcript text in the composer and send it as ordinary Markdown."
kind: "package-reference"
---

# @deepseek-ai/dsh-message-quotes

English | [中文](README.zh.md)

## Summary

Select transcript text and add it to the current composer as one removable quote. Sending produces ordinary Markdown blockquote lines. Refused sends retain the quote alongside the complete draft. Removed Sessions and unavailable child Sessions cannot receive quotes.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

The Web composition mounts the Client entry in its conversation view. Quotes share the current [Conversation](../../../docs/subsystems/conversation.md) input and use the keyed `conversation.chat.text-interaction` slot. There are no package configuration fields.

<a id="model-experience"></a>

## Model Experience

### Submitted quote text

#### What the model sees

A quote becomes ordinary Markdown: each selected line starts with `> `, with a blank line before and after surrounding prose. Quoted resource markers remain literal text. Quotes add no metadata or Session event type.

#### Token effect

Only submitted quote text and its Markdown markers add request tokens. The selection action and draft preview add none before submission.

#### KV Cache effect

Submitted quotes append user-message text to conversation history. They leave earlier message tokens intact; editing a draft changes only the next submitted message. Provider cache availability remains external.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Recognition covers explicit blockquote lines with up to three leading spaces; lazy continuation and fenced-code interpretation are not supported.
- Draft quotes use the existing conversation draft store; there is no separate quote library.

### Dev Note

None.
