# Agent Note: Media import admission for desktop creation

Status: proposed

English | [中文](2026-09-20-media-import-admission.zh.md)

## Problem

Conversation-driven creation needs selected audio and video files, but the command attachment envelope currently admits images only. Treating a local path or a media identifier as an image attachment would bypass type, ownership, and file-admission rules. A generic chat attachment change would affect model input and both SDKs even though V1 only needs files selected for media tools.

## Proposal

The desktop-media plugin will provide a separate import panel and controlled upload route. The Host will accept a file only after the user selects it, enforce configurable byte and duration limits, inspect bytes and media streams with ffprobe, copy it to managed storage, and atomically commit a durable record with an opaque, discriminated `audio` or `video` reference. A rejected or interrupted import will not expose a usable reference. The Client will show an actionable rejection for unsupported type, excessive size or duration, corrupt streams, and failed copy. Transport for Client uploads must be bounded and measured; whole-file Base64 RPC is excluded.

Media tools will accept only selected and registered references belonging to their session and workspace. The Host will resolve a real managed path from the record and validate ownership before reading or uploading bytes; model-supplied paths, URLs, and unregistered identifiers will fail. The model will see recorded import results and opaque identifiers, never local bytes or signed URLs. This rule applies to new media tools and does not change existing `read_image` permissions.

The [image attachment decision](../../implemented/feature/2026-08-17-command-image-attachment-envelope.md) explicitly says that a second supported attachment kind is the condition for widening the command envelope to a tagged union. V1 media imports are plugin records for media tools, not command-envelope attachments or generic model inputs, so they do not satisfy that condition. If chat later accepts audio or video attachments, that change must widen the tagged union and update admission, storage, command-envelope validation, model projection, and both SDK expectations together.

## Alternatives considered

**Reuse image attachments for audio and video.** An image reference would falsely imply image admission and model-visible semantics; it would make type-specific limits and access checks ambiguous.

**Widen the command envelope in V1.** No V1 user flow sends audio or video as a generic chat attachment. The change would enlarge command, projection, and SDK scope without a consumer.

**Pass local paths directly to tools.** A model path has no selection record or session/workspace ownership and can name unrelated files.

## Acceptance criteria

- A selected valid file produces one durable opaque reference after bounded transfer, type and stream validation, and atomic file commit; interruption leaves no usable reference.
- Tests reject disguised file types, invalid streams, oversized or overlong files, foreign-session references, and model-supplied paths before provider upload.
- The command attachment envelope and image prompt union stay unchanged in V1; model-visible import results can be reconstructed from the session log.

## Risks

Browser-to-Host upload transport may need new bounded streaming support and installed-app validation. ffprobe results do not prove that an external player will handle every codec. A later chat attachment feature will require the larger tagged-union change described above.
