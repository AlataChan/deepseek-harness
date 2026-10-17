from __future__ import annotations

import json
import os
import re
import time
from collections.abc import Callable, Iterable
from typing import Any

import httpx
from pydantic import BaseModel


_sleep = time.sleep
_SENSITIVE_ENV_NAME = re.compile(r"(?:KEY|TOKEN|SECRET|PASSWORD)", re.IGNORECASE)
_KV_SECRET_PATTERN = re.compile(
    r"(?i)\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|token)\s*([=:])\s*(['\"]?)[^\s'\"&,;]+\3"
)


class ChatRequest(BaseModel):
    messages: list[dict]
    json_object: bool = False
    temperature: float = 0.1
    max_tokens: int = 2000


class ChatResponse(BaseModel):
    content: str
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    finish_reason: str | None = None


class LLMError(RuntimeError):
    """Base class for LLM client failures."""


class LLMNetworkError(LLMError):
    """Network or retryable upstream failure."""


class LLMAuthError(LLMError):
    """Authentication or authorization failure."""


class LLMRateLimitError(LLMError):
    """Rate limit remained after retries."""


class LLMInvalidOutputError(LLMError):
    """JSON mode was requested but the model response was not JSON."""

    def __init__(self, message: str, content: str = "") -> None:
        super().__init__(message)
        self.content = content


Transport = Callable[[str, str, dict[str, str], dict[str, Any], int], tuple[int, dict]]


def _extract_header_secrets(headers: dict[str, str]) -> list[str]:
    secrets: list[str] = []
    for name, value in headers.items():
        if not value or not _SENSITIVE_ENV_NAME.search(name) and name.lower() != "authorization":
            continue
        trimmed = value.strip()
        if trimmed:
            secrets.append(trimmed)
        if trimmed.lower().startswith("bearer "):
            token = trimmed[7:].strip()
            if token:
                secrets.append(token)
    return secrets


def _redact_snippet(text: str, secrets: Iterable[str] = (), limit: int = 200) -> str:
    collapsed = " ".join(text.split())
    candidate_secrets = {s.strip() for s in secrets if s and len(s.strip()) >= 4}
    for env_key, env_val in os.environ.items():
        if env_val and _SENSITIVE_ENV_NAME.search(env_key) and len(env_val.strip()) >= 4:
            candidate_secrets.add(env_val.strip())
    for secret in sorted(candidate_secrets, key=len, reverse=True):
        collapsed = collapsed.replace(secret, "[REDACTED]")
    redacted = re.sub(r"(?i)\bBearer\s+\S+", "Bearer [REDACTED]", collapsed)
    redacted = _KV_SECRET_PATTERN.sub(r"\1\2[REDACTED]", redacted)
    redacted = re.sub(r"\bsk-[A-Za-z0-9_-]{8,}\b", "sk-[REDACTED]", redacted)
    return redacted if len(redacted) <= limit else f"{redacted[:limit]}..."


def _decode_http_response(response: httpx.Response, secrets: Iterable[str] = ()) -> dict[str, Any]:
    raw_text = response.text or ""
    try:
        parsed = response.json()
    except ValueError:
        snippet = _redact_snippet(raw_text, secrets=secrets)
        detail = f": {snippet}" if snippet else " (empty response body)"
        message = f"LLM request failed with HTTP {response.status_code}{detail}"
        if response.status_code >= 400:
            return {"error": {"message": message}}
        raise LLMInvalidOutputError(message, content=snippet) from None
    if isinstance(parsed, dict):
        return parsed
    snippet = _redact_snippet(raw_text, secrets=secrets)
    detail = f": {snippet}" if snippet else ""
    message = f"LLM request failed with HTTP {response.status_code} (expected JSON object){detail}"
    if response.status_code >= 400:
        return {"error": {"message": message}}
    raise LLMInvalidOutputError(message, content=snippet)


def _default_transport() -> Transport:
    def _call(method: str, url: str, headers: dict[str, str], json_body: dict[str, Any], timeout: int) -> tuple[int, dict]:
        if method.upper() != "POST":
            raise ValueError(f"Unsupported method: {method}")
        response = httpx.post(url, headers=headers, json=json_body, timeout=timeout)
        return response.status_code, _decode_http_response(response, secrets=_extract_header_secrets(headers))

    return _call


class ChatClient:
    def __init__(
        self,
        base_url: str,
        api_key: str | None = None,
        default_model: str = "qwen2.5:7b-instruct",
        timeout: int = 60,
        max_retries: int = 2,
        transport: Transport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.default_model = default_model
        self.timeout = timeout
        self.max_retries = max_retries
        self._transport = transport or _default_transport()

    def chat(self, req: ChatRequest) -> ChatResponse:
        body: dict[str, Any] = {
            "model": self.default_model,
            "messages": req.messages,
            "temperature": req.temperature,
            "max_tokens": req.max_tokens,
        }
        if req.json_object:
            body["response_format"] = {"type": "json_object"}

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        response = self._send_with_retries(
            "POST",
            f"{self.base_url}/chat/completions",
            headers,
            body,
        )
        parsed = _parse_response(response, self.default_model)
        if req.json_object:
            parse_json_content(parsed.content)
        return parsed

    def _send_with_retries(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        body: dict[str, Any],
    ) -> dict:
        last_error: Exception | None = None
        attempts = self.max_retries + 1
        secrets = ([self.api_key] if self.api_key else []) + _extract_header_secrets(headers)
        for attempt in range(attempts):
            try:
                status, response_json = self._transport(method, url, headers, body, self.timeout)
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt == attempts - 1:
                    raise LLMNetworkError(_redact_snippet(str(exc), secrets=secrets)) from exc
                _sleep(_retry_delay(attempt))
                continue

            if status in (401, 403):
                raise LLMAuthError(_error_message(response_json, status, secrets=secrets))
            if status == 429:
                if attempt == attempts - 1:
                    raise LLMRateLimitError(_error_message(response_json, status, secrets=secrets))
                _sleep(_retry_delay(attempt))
                continue
            if status >= 500:
                if attempt == attempts - 1:
                    raise LLMNetworkError(_error_message(response_json, status, secrets=secrets))
                _sleep(_retry_delay(attempt))
                continue
            if status >= 400:
                raise LLMError(_error_message(response_json, status, secrets=secrets))
            return response_json

        raise LLMNetworkError(_redact_snippet(str(last_error), secrets=secrets) if last_error else "LLM request failed")


def parse_json_content(text: str) -> Any:
    """Parse a JSON value, including fenced or prose-wrapped objects."""
    stripped = text.strip()
    if stripped == "":
        raise LLMInvalidOutputError("Model response was empty", content=text)
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", stripped)
    if fenced is not None:
        try:
            return json.loads(fenced.group(1).strip())
        except json.JSONDecodeError:
            pass
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(stripped[start : end + 1])
        except json.JSONDecodeError:
            pass
    raise LLMInvalidOutputError("Model response was not valid JSON", content=text)


def _parse_response(data: dict, default_model: str) -> ChatResponse:
    choices = data.get("choices") or []
    choice = choices[0] if choices else {}
    message = choice.get("message") or {}
    usage = data.get("usage") or {}
    return ChatResponse(
        content=str(message.get("content", "")),
        model=str(data.get("model") or default_model),
        input_tokens=usage.get("prompt_tokens"),
        output_tokens=usage.get("completion_tokens"),
        finish_reason=choice.get("finish_reason"),
    )


def _error_message(response_json: dict, status: int, secrets: Iterable[str] = ()) -> str:
    error = response_json.get("error")
    if isinstance(error, dict):
        return _redact_snippet(str(error.get("message") or error), secrets=secrets)
    if error:
        return _redact_snippet(str(error), secrets=secrets)
    return f"LLM request failed with HTTP {status}"


def _retry_delay(attempt: int) -> float:
    return min(0.25 * (2**attempt), 2.0)
