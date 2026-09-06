# Provider-agnostic LLM interface, Python port of
# ../e2e-travel-concierge/agent/chat/providers/types.ts. The rest of the
# agent talks to this shape; each provider adapter translates to/from it.

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Literal, Optional

Role = Literal["user", "assistant", "tool"]


@dataclass
class LLMMessage:
    role: Role
    # Text for user/assistant text turns; JSON tool result for tool turns.
    content: str
    # Set on an assistant tool-call turn and on the matching tool-result turn.
    tool_call_id: Optional[str] = None
    tool_name: Optional[str] = None
    # Set on an assistant tool-call turn: the arguments the model chose.
    tool_args: Optional[Dict[str, Any]] = None
    # Gemini-only: the `thoughtSignature` Gemini attaches to a functionCall
    # part. Newer Gemini models reject a follow-up request whose replayed
    # history includes a functionCall turn without this signature (see
    # gemini_provider.py) -- other providers ignore this field.
    gemini_thought_signature: Optional[str] = None


@dataclass
class ToolCallRequest:
    tool_call_id: str
    tool_name: str
    args: Dict[str, Any] = field(default_factory=dict)
    gemini_thought_signature: Optional[str] = None
    type: Literal["tool_call"] = "tool_call"


@dataclass
class TextResponse:
    content: str
    type: Literal["text"] = "text"


LLMResponse = Any  # ToolCallRequest | TextResponse, discriminated by .type
