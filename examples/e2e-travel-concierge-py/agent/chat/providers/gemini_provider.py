# Gemini adapter, Python port of ../../geminiProvider.ts. REST call (Google
# AI Studio's generateContent endpoint), no SDK dependency needed -- `requests`
# is already a helix-sdk-py dependency. Implements the same provider-agnostic
# interface as the Anthropic/OpenAI adapters: adding this file plus one
# branch in index.py is the whole integration.

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List, Optional

import requests

from agent.chat.llm_error import llm_error_from_http
from agent.chat.tool_schemas import SYSTEM_PROMPT, TOOL_SCHEMAS
from agent.chat.types import LLMMessage, TextResponse, ToolCallRequest
from config import env

DEFAULT_MODEL = "gemini-flash-latest"
API_BASE = "https://generativelanguage.googleapis.com/v1beta"


class GeminiProvider:
    def __init__(self) -> None:
        self._api_key = env.llm_api_key()
        self._model = env.llm_model or DEFAULT_MODEL

    def complete(self, messages: List[LLMMessage]) -> Any:
        body = {
            "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": _to_gemini_contents(messages),
            "tools": [
                {
                    "functionDeclarations": [
                        {"name": t.name, "description": t.description, "parameters": t.parameters}
                        for t in TOOL_SCHEMAS
                    ]
                }
            ],
        }

        res = requests.post(
            f"{API_BASE}/models/{self._model}:generateContent",
            json=body,
            headers={"content-type": "application/json", "x-goog-api-key": self._api_key},
            timeout=60,
        )
        if not res.ok:
            raise llm_error_from_http("gemini", res.status_code, res.text)

        data = res.json()
        parts: List[Dict[str, Any]] = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        fn_call_part = next((p for p in parts if p.get("functionCall")), None)
        if fn_call_part:
            fn_call = fn_call_part["functionCall"]
            return ToolCallRequest(
                # Gemini doesn't return a call id the way Anthropic/OpenAI do
                # -- the provider-agnostic layer only needs a unique opaque
                # string that round-trips through the tool-result turn
                # (run_chat_turn.py matches by tool_name, not by this id), so
                # one is synthesized here.
                tool_call_id=f"gemini-{fn_call.get('name')}-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}",
                tool_name=fn_call.get("name", ""),
                args=fn_call.get("args") or {},
                gemini_thought_signature=fn_call_part.get("thoughtSignature"),
            )

        text = "".join(p.get("text", "") for p in parts)
        return TextResponse(content=text)


def _to_gemini_contents(messages: List[LLMMessage]) -> List[Dict[str, Any]]:
    contents = []
    for m in messages:
        if m.role == "tool":
            contents.append(
                {
                    "role": "user",
                    "parts": [
                        {
                            "functionResponse": {
                                "name": m.tool_name or "",
                                "response": _as_response_object(m.content),
                            }
                        }
                    ],
                }
            )
        elif m.role == "assistant" and m.tool_call_id:
            part: Dict[str, Any] = {
                "functionCall": {"name": m.tool_name or "", "args": m.tool_args or {}},
            }
            if m.gemini_thought_signature:
                part["thoughtSignature"] = m.gemini_thought_signature
            contents.append({"role": "model", "parts": [part]})
        else:
            contents.append({"role": "model" if m.role == "assistant" else "user", "parts": [{"text": m.content}]})
    return contents


def _as_response_object(content: str) -> Dict[str, Any]:
    """Gemini's functionResponse.response must be a JSON object -- the tool
    results in this agent are always JSON-serialized objects already, but
    this stays defensive rather than assuming that never changes."""
    import json

    try:
        parsed = json.loads(content)
        return parsed if isinstance(parsed, dict) else {"result": parsed}
    except (ValueError, TypeError):
        return {"result": content}
