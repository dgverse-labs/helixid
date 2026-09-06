from __future__ import annotations

from typing import Any, List

from openai import OpenAI

from agent.chat.providers.openai_shared import chat_complete
from agent.chat.types import LLMMessage
from config import env

MODEL = "gpt-4o"


class OpenAIProvider:
    def __init__(self) -> None:
        self._client = OpenAI(api_key=env.llm_api_key())

    def complete(self, messages: List[LLMMessage]) -> Any:
        return chat_complete(self._client, MODEL, messages, "openai")
