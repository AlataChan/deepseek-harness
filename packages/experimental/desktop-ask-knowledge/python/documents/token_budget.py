"""Full-document token estimation, request framing, and budget planning for Ask Knowledge.

Calculates realistic token allowances including prompts, schemas, bounded context,
and output/retry reserves for entire manifests rather than short prefixes.
"""

from __future__ import annotations

import math
from typing import Any

# Default framing constants based on measured Ask Knowledge templates
DEFAULT_PROMPT_TEMPLATE_TOKENS = 320
DEFAULT_SCHEMA_TOKENS = 950
DEFAULT_LIBRARY_CONTEXT_TOKENS = 1200
DEFAULT_OUTPUT_RESERVE_TOKENS = 2048
DEFAULT_RETRY_FACTOR = 0.20  # 20% safety margin for retries/formatting faults

VALID_POLICIES = {"deepseek", "deepseek-chat", "exact", "byte-fallback"}


def estimate_tokens(text: str, policy: str = "byte-fallback") -> int:
    """Estimate token count for a string under a validated policy.

    Rejects naive characters/4 or unverified estimation heuristics.
    """
    if policy not in VALID_POLICIES:
        raise ValueError(f"Unknown token estimator policy: '{policy}'. Valid policies: {sorted(VALID_POLICIES)}")

    if not text:
        return 0

    # UTF-8 byte count
    utf8_bytes = len(text.encode("utf-8"))

    if policy in {"deepseek", "deepseek-chat", "exact"}:
        raise ValueError("Exact tokenizer unavailable; use byte-fallback instead of an unverified ratio")

    if policy == "byte-fallback":
        # Verified byte fallback: ceil(utf8_bytes * 1.3) + 16 framing tokens
        return math.ceil(utf8_bytes * 1.3) + 16

    raise ValueError(f"Unknown token estimator policy: {policy}")


def estimate_chunk_request_tokens(
    chunk_text: str,
    policy: str = "byte-fallback",
    prompt_tokens: int = DEFAULT_PROMPT_TEMPLATE_TOKENS,
    schema_tokens: int = DEFAULT_SCHEMA_TOKENS,
    context_tokens: int = DEFAULT_LIBRARY_CONTEXT_TOKENS,
    output_reserve: int = DEFAULT_OUTPUT_RESERVE_TOKENS,
) -> dict[str, int]:
    """Calculate the complete token breakdown for a single chunk extraction request."""
    input_chunk_tokens = estimate_tokens(chunk_text, policy)
    total_input = prompt_tokens + schema_tokens + context_tokens + input_chunk_tokens
    total_request = total_input + output_reserve

    return {
        "chunkInput": input_chunk_tokens,
        "promptTemplate": prompt_tokens,
        "schema": schema_tokens,
        "libraryContext": context_tokens,
        "totalInput": total_input,
        "outputReserve": output_reserve,
        "totalRequest": total_request,
    }


def calculate_manifest_budget(
    chunks: list[dict[str, Any]],
    policy: str = "byte-fallback",
    approved_budget: int | None = None,
    output_reserve_per_chunk: int = DEFAULT_OUTPUT_RESERVE_TOKENS,
    prompt_tokens: int = DEFAULT_PROMPT_TEMPLATE_TOKENS,
    schema_tokens: int = DEFAULT_SCHEMA_TOKENS,
    context_tokens: int = DEFAULT_LIBRARY_CONTEXT_TOKENS,
    retry_factor: float = DEFAULT_RETRY_FACTOR,
) -> dict[str, Any]:
    """Calculate the complete required token budget across an entire document manifest.

    Validates that approved_budget covers all chunks, not merely a prefix.
    """
    if policy not in VALID_POLICIES:
        raise ValueError(f"Unknown token estimator policy: '{policy}'")

    total_chunks = len(chunks)
    if total_chunks == 0:
        return {
            "policy": policy,
            "totalChunks": 0,
            "inputTokens": 0,
            "outputTokensReserved": 0,
            "retryAllowanceTokens": 0,
            "totalTokensRequired": 0,
            "approvedBudget": approved_budget,
            "canProceed": True,
            "deficit": 0,
        }

    summed_input = 0
    summed_output = 0

    for c in chunks:
        c_text = c.get("fullText") or c.get("primaryText") or ""
        req = estimate_chunk_request_tokens(
            c_text,
            policy=policy,
            prompt_tokens=prompt_tokens,
            schema_tokens=schema_tokens,
            context_tokens=context_tokens,
            output_reserve=output_reserve_per_chunk,
        )
        summed_input += req["totalInput"]
        summed_output += req["outputReserve"]

    retry_allowance = math.ceil((summed_input + summed_output) * retry_factor)
    total_required = summed_input + summed_output + retry_allowance

    can_proceed = True
    deficit = 0

    if approved_budget is not None:
        if approved_budget < total_required:
            can_proceed = False
            deficit = total_required - approved_budget

    return {
        "policy": policy,
        "totalChunks": total_chunks,
        "inputTokens": summed_input,
        "outputTokensReserved": summed_output,
        "retryAllowanceTokens": retry_allowance,
        "totalTokensRequired": total_required,
        "approvedBudget": approved_budget,
        "canProceed": can_proceed,
        "deficit": deficit,
    }
