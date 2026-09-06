# Normalized LLM-provider error handling, Python port of
# ../e2e-travel-concierge/agent/chat/providers/llmError.ts. Each provider
# adapter throws its own shape of error on failure -- this maps all of them
# onto one small, closed set of codes so the rest of the agent (run_chat_turn,
# the /chat route, the web UI) only ever has to handle five cases, with a
# message that's safe to show a user, instead of a raw provider stack trace /
# JSON body landing in the chat transcript.

from __future__ import annotations

import json
import math
import re
from typing import Any, Dict, Literal, Optional

LlmErrorCode = Literal["RATE_LIMITED", "AUTH_FAILED", "INVALID_REQUEST", "PROVIDER_UNAVAILABLE", "UNKNOWN"]

_HTTP_STATUS_BY_CODE: Dict[str, int] = {
    "RATE_LIMITED": 429,
    "AUTH_FAILED": 500,
    "INVALID_REQUEST": 500,
    "PROVIDER_UNAVAILABLE": 503,
    "UNKNOWN": 500,
}


class LlmError(Exception):
    def __init__(
        self,
        *,
        code: LlmErrorCode,
        provider: str,
        user_message: str,
        retry_after_seconds: Optional[int] = None,
        cause: Any = None,
    ) -> None:
        super().__init__(f"[{provider}] {code}: {user_message}")
        self.code = code
        self.provider = provider
        self.http_status = _HTTP_STATUS_BY_CODE[code]
        self.retry_after_seconds = retry_after_seconds
        self.user_message = user_message
        self.cause = cause


def _classify_http_status(status: int) -> LlmErrorCode:
    if status == 429:
        return "RATE_LIMITED"
    if status in (401, 403):
        return "AUTH_FAILED"
    if status in (400, 404, 422):
        return "INVALID_REQUEST"
    if status >= 500 or status == 408:
        return "PROVIDER_UNAVAILABLE"
    return "UNKNOWN"


def _default_user_message(provider: str, code: LlmErrorCode, retry_after_seconds: Optional[int] = None) -> str:
    if code == "RATE_LIMITED":
        if retry_after_seconds:
            return f"{provider} rate-limited this request — try again in about {retry_after_seconds}s."
        return f"{provider} rate-limited this request — try again shortly."
    if code == "AUTH_FAILED":
        return f"{provider} rejected the API key — check LLM_API_KEY in .env."
    if code == "INVALID_REQUEST":
        return f"{provider} rejected the request as malformed."
    if code == "PROVIDER_UNAVAILABLE":
        return f"{provider} is temporarily unavailable — try again shortly."
    return f"{provider} returned an unexpected error."


def _extract_gemini_retry_delay_seconds(body: Any) -> Optional[int]:
    """Google's RetryInfo detail, when present:
    { "@type": "...RetryInfo", "retryDelay": "45s" }."""
    if not isinstance(body, dict):
        return None
    error = body.get("error")
    details = error.get("details") if isinstance(error, dict) else None
    if not isinstance(details, list):
        return None
    for detail in details:
        if isinstance(detail, dict) and detail.get("@type") == "type.googleapis.com/google.rpc.RetryInfo":
            raw = detail.get("retryDelay")
            if isinstance(raw, str):
                match = re.match(r"^(\d+(?:\.\d+)?)s$", raw)
                if match:
                    return math.ceil(float(match.group(1)))
    return None


def llm_error_from_http(provider: str, status: int, body_text: str) -> LlmError:
    """Builds an LlmError from a raw HTTP status + response body (Gemini's
    REST adapter)."""
    try:
        parsed: Any = json.loads(body_text)
    except (ValueError, TypeError):
        parsed = None
    code = _classify_http_status(status)
    retry_after_seconds = _extract_gemini_retry_delay_seconds(parsed) if code == "RATE_LIMITED" else None
    return LlmError(
        code=code,
        provider=provider,
        user_message=_default_user_message(provider, code, retry_after_seconds),
        retry_after_seconds=retry_after_seconds,
        cause=parsed if parsed is not None else body_text,
    )


def llm_error_from_sdk_error(provider: str, err: Exception) -> LlmError:
    """Builds an LlmError from an SDK exception (the openai and anthropic
    Python SDKs both raise an APIStatusError with a numeric `.status_code`
    and the raw httpx response on `.response`; a connection-level failure
    before any response came back — APIConnectionError/APITimeoutError —
    has neither)."""
    status = getattr(err, "status_code", None)
    if not isinstance(status, int):
        # Not an API-level error (e.g. a network failure before a response came back).
        return LlmError(
            code="PROVIDER_UNAVAILABLE",
            provider=provider,
            user_message=_default_user_message(provider, "PROVIDER_UNAVAILABLE"),
            cause=err,
        )
    response = getattr(err, "response", None)
    headers = getattr(response, "headers", None)
    retry_after_header = headers.get("retry-after") if headers is not None else None
    retry_after_seconds = (
        int(retry_after_header) if status == 429 and isinstance(retry_after_header, str) and retry_after_header.isdigit() else None
    )
    code = _classify_http_status(status)
    return LlmError(
        code=code,
        provider=provider,
        user_message=_default_user_message(provider, code, retry_after_seconds),
        retry_after_seconds=retry_after_seconds,
        cause=err,
    )
