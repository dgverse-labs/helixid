# Shared chat-completion logic for the OpenAI-compatible providers (plain
# OpenAI and Azure OpenAI), Python port of ../../openaiShared.ts. AzureOpenAI
# extends OpenAI in the `openai` package too, so the same code drives both --
# only the client instance and the model/deployment name differ.

from __future__ import annotations

import json
from typing import Any, List

from agent.chat.llm_error import llm_error_from_sdk_error
from agent.chat.tool_schemas import SYSTEM_PROMPT, TOOL_SCHEMAS
from agent.chat.types import LLMMessage, TextResponse, ToolCallRequest


def chat_complete(client: Any, model: str, messages: List[LLMMessage], provider_label: str) -> Any:
    try:
        res = client.chat.completions.create(
            model=model,
            messages=_to_openai_messages(messages),
            tools=[
                {"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}}
                for t in TOOL_SCHEMAS
            ],
        )
    except Exception as err:  # noqa: BLE001
        raise llm_error_from_sdk_error(provider_label, err) from err

    choice = res.choices[0].message if res.choices else None
    tool_calls = getattr(choice, "tool_calls", None) if choice else None
    tool_call = tool_calls[0] if tool_calls else None
    if tool_call is not None and tool_call.type == "function":
        return ToolCallRequest(
            tool_call_id=tool_call.id,
            tool_name=tool_call.function.name,
            args=json.loads(tool_call.function.arguments or "{}"),
        )

    return TextResponse(content=(choice.content if choice and choice.content else "") or "")


def _to_openai_messages(messages: List[LLMMessage]) -> List[dict]:
    mapped: List[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in messages:
        if m.role == "tool":
            mapped.append({"role": "tool", "tool_call_id": m.tool_call_id or "", "content": m.content})
        elif m.role == "assistant" and m.tool_call_id:
            mapped.append(
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": m.tool_call_id,
                            "type": "function",
                            "function": {"name": m.tool_name or "", "arguments": json.dumps(m.tool_args or {})},
                        }
                    ],
                }
            )
        elif m.role == "assistant":
            mapped.append({"role": "assistant", "content": m.content})
        else:
            mapped.append({"role": "user", "content": m.content})
    return mapped
