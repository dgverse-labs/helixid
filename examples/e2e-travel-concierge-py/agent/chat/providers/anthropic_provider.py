from __future__ import annotations

from typing import Any, List

import anthropic

from agent.chat.llm_error import llm_error_from_sdk_error
from agent.chat.tool_schemas import SYSTEM_PROMPT, TOOL_SCHEMAS
from agent.chat.types import LLMMessage, TextResponse, ToolCallRequest
from config import env

MODEL = "claude-sonnet-5"


class AnthropicProvider:
    def __init__(self) -> None:
        self._client = anthropic.Anthropic(api_key=env.llm_api_key())

    def complete(self, messages: List[LLMMessage]) -> Any:
        try:
            res = self._client.messages.create(
                model=MODEL,
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                messages=_to_anthropic_messages(messages),
                tools=[{"name": t.name, "description": t.description, "input_schema": t.parameters} for t in TOOL_SCHEMAS],
            )
        except Exception as err:  # noqa: BLE001
            raise llm_error_from_sdk_error("anthropic", err) from err

        tool_use = next((b for b in res.content if b.type == "tool_use"), None)
        if tool_use is not None:
            return ToolCallRequest(tool_call_id=tool_use.id, tool_name=tool_use.name, args=tool_use.input or {})

        text_block = next((b for b in res.content if b.type == "text"), None)
        return TextResponse(content=text_block.text if text_block else "")


# Our provider-agnostic history already alternates user / assistant, so each
# tool_use is its own assistant turn and each tool result its own user turn --
# exactly what the Anthropic API expects.
def _to_anthropic_messages(messages: List[LLMMessage]) -> List[dict]:
    mapped: List[dict] = []
    for m in messages:
        if m.role == "tool":
            mapped.append(
                {
                    "role": "user",
                    "content": [{"type": "tool_result", "tool_use_id": m.tool_call_id or "", "content": m.content}],
                }
            )
        elif m.role == "assistant" and m.tool_call_id:
            mapped.append(
                {
                    "role": "assistant",
                    "content": [
                        {"type": "tool_use", "id": m.tool_call_id, "name": m.tool_name or "", "input": m.tool_args or {}}
                    ],
                }
            )
        else:
            mapped.append({"role": "assistant" if m.role == "assistant" else "user", "content": m.content})
    return mapped
