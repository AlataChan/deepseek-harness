"""Document chunking and span coverage verification for Ask Knowledge.

Divides normalized blocks into bounded chunks with structural boundaries,
table header preservation, and verified contiguous character coverage.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any


def create_chunks_from_blocks(
    document_id: str,
    revision_id: str,
    blocks: list[dict[str, Any]] | None,
    full_text: str,
    max_chunk_chars: int = 1500,
    overlap_chars: int = 200,
) -> dict[str, Any]:
    """Group blocks into ordered chunks with exact primary span accounting.

    Every character in full_text is assigned to exactly one chunk's primary range.
    Table headers are repeated in subsequent table chunks for context.
    """
    if type(max_chunk_chars) is not int or max_chunk_chars < 1:
        raise ValueError("max_chunk_chars must be a positive integer")
    if not full_text or (blocks is not None and len(blocks) == 0):
        return {
            "documentId": document_id,
            "revisionId": revision_id,
            "totalChunks": 0,
            "totalChars": 0,
            "chunks": [],
            "sha256": hashlib.sha256(b"").hexdigest(),
        }

    chunks: list[dict[str, Any]] = []
    current_blocks: list[dict[str, Any]] = []
    current_chars = 0
    current_start = 0
    chunk_index = 0

    active_headings: list[str] = []
    current_table_header: str | None = None

    def flush_chunk(end_char: int, is_final: bool = False) -> None:
        nonlocal chunk_index, current_blocks, current_chars, current_start
        if not current_blocks and blocks is not None and not is_final:
            return

        primary_text = full_text[current_start:end_char]
        if not primary_text and not is_final:
            return

        # Build overlap context
        prefix_start = max(0, current_start - overlap_chars)
        overlap_prefix = full_text[prefix_start:current_start] if prefix_start < current_start else ""

        # Prepend table header context if this chunk continues a table
        context_header = ""
        if current_table_header and not primary_text.startswith(current_table_header):
            context_header = f"[Table Context: {current_table_header}]\n"

        chunk_id = f"{document_id}_c{chunk_index + 1:04d}"
        start_line = full_text.count("\n", 0, current_start) + 1
        end_line = full_text.count("\n", 0, end_char) + 1
        chunks.append({
            "chunkId": chunk_id,
            "chunkIndex": chunk_index,
            "index": chunk_index,
            "documentId": document_id,
            "revisionId": revision_id,
            "start": current_start,
            "end": end_char,
            "startLine": start_line,
            "endLine": end_line,
            "primaryText": primary_text,
            "primaryStartChar": current_start,
            "primaryEndChar": end_char,
            "overlapPrefix": overlap_prefix,
            "contextHeader": context_header,
            "fullText": context_header + overlap_prefix + primary_text,
            "headings": list(active_headings),
            "blockIds": [b["id"] for b in current_blocks if "id" in b],
            "charLength": len(primary_text),
        })

        chunk_index += 1
        current_start = end_char
        current_blocks = []
        current_chars = 0

    if blocks is None:
        while current_start < len(full_text):
            end = min(len(full_text), current_start + max_chunk_chars)
            if end < len(full_text):
                lower = current_start + max_chunk_chars // 2
                for separator in ('\n\n', '\n'):
                    boundary = full_text.rfind(separator, lower, end)
                    if boundary >= lower:
                        end = boundary + len(separator)
                        break
                else:
                    boundaries = list(re.finditer(r'[。！？]|[.!?](?=\s)', full_text[lower:end]))
                    if boundaries:
                        end = lower + boundaries[-1].end()
            flush_chunk(end)
    else:
        for block in blocks:
            block_text = block.get("text", "")
            block_kind = block.get("kind", "paragraph")

            if block_kind == "heading":
                active_headings = [block_text]
                current_table_header = None
            elif block_kind == "table" or (block_text.startswith("|") and "---" in block_text):
                lines = [line.strip() for line in block_text.splitlines() if line.strip()]
                if len(lines) >= 2 and "---" in lines[1]:
                    current_table_header = lines[0]

            block_len = len(block_text)

            # Handle oversized block (exceeds max_chunk_chars)
            if block_len > max_chunk_chars:
                # First flush any pending accumulated blocks
                if current_chars > 0:
                    flush_chunk(current_start + current_chars)

                # Split oversized block into pieces at sentence/line boundaries
                sub_start = 0
                while sub_start < block_len:
                    sub_end = min(block_len, sub_start + max_chunk_chars)
                    # Try to break at sentence or newline
                    if sub_end < block_len:
                        cut = block_text.rfind("。", sub_start, sub_end)
                        if cut == -1:
                            cut = block_text.rfind("\n", sub_start, sub_end)
                        if cut != -1 and cut > sub_start + 200:
                            sub_end = cut + 1

                    piece = block_text[sub_start:sub_end]
                    sub_primary_end = current_start + len(piece)
                    current_blocks = [block]
                    flush_chunk(sub_primary_end)
                    sub_start = sub_end
                continue

            # If adding this block exceeds limit, flush current chunk first
            if current_chars + block_len > max_chunk_chars and current_chars > 0:
                flush_chunk(current_start + current_chars)

            current_blocks.append(block)
            current_chars += block_len + 2  # account for spacing

        # Flush final chunk
        if current_start < len(full_text):
            flush_chunk(len(full_text), is_final=True)

    manifest_bytes = json.dumps(chunks, sort_keys=True).encode("utf-8")
    manifest_hash = hashlib.sha256(manifest_bytes).hexdigest()

    return {
        "documentId": document_id,
        "revisionId": revision_id,
        "totalChunks": len(chunks),
        "totalChars": len(full_text),
        "chunks": chunks,
        "sha256": manifest_hash,
    }


def verify_chunk_coverage(full_text: str, chunks: list[dict[str, Any]]) -> dict[str, Any]:
    """Verify that chunks form an exact contiguous cover of full_text with no gaps or duplicates.

    Derives expected coverage directly from full_text and never trusts a producer complete flag.
    """
    total_len = len(full_text)
    if total_len == 0:
        return {"ok": len(chunks) == 0, "coveredChars": 0, "totalChars": 0, "errors": []}

    if not chunks:
        return {
            "ok": False,
            "coveredChars": 0,
            "totalChars": total_len,
            "errors": [f"Missing chunks: document has {total_len} chars but 0 chunks provided"],
        }

    errors: list[str] = []
    expected_start = 0
    covered_chars = 0

    for idx, c in enumerate(chunks):
        p_start = c.get("primaryStartChar", c.get("start", -1))
        p_end = c.get("primaryEndChar", c.get("end", -1))
        if not isinstance(p_start, int) or not isinstance(p_end, int) or p_start < 0:
            errors.append(f"Invalid span bounds in chunk {idx}: [{p_start}:{p_end}]")
            continue

        # Check start alignment
        if p_start != expected_start:
            if p_start > expected_start:
                errors.append(f"Gap detected between chars {expected_start} and {p_start} before chunk {idx}")
            else:
                errors.append(f"Duplicate/overlapping primary span: chunk {idx} starts at {p_start} < expected {expected_start}")

        # Check bounds
        if p_end < p_start:
            errors.append(f"Invalid inverted span in chunk {idx}: {p_start} > {p_end}")
        if p_end > total_len:
            errors.append(f"Span out of bounds in chunk {idx}: {p_end} > {total_len}")

        # Verify text slice equality when primaryText or request is present
        expected_slice = full_text[max(0, p_start):max(0, min(total_len, p_end))]
        if "primaryText" in c and c.get("primaryText") != expected_slice:
            errors.append(f"Primary text mismatch in chunk {idx} at [{p_start}:{p_end}]")
        elif "request" in c and isinstance(c.get("request"), dict):
            messages = c["request"].get("messages") or []
            prompt = messages[0].get("content", "") if messages and isinstance(messages[0], dict) else ""
            if expected_slice not in prompt or f"[{p_start},{p_end})" not in prompt:
                errors.append(f"Request prompt slice mismatch in chunk {idx} at [{p_start},{p_end}]")

        covered_chars += max(0, p_end - p_start)
        expected_start = p_end

    if expected_start < total_len:
        errors.append(f"Trailing gap: document has {total_len} chars but chunks only cover up to {expected_start}")

    return {
        "ok": len(errors) == 0,
        "coveredChars": covered_chars,
        "totalChars": total_len,
        "errors": errors,
    }
