# Azure OpenAI uses the same wire protocol as OpenAI; the deployment name
# plays the role of the model. LLM_API_KEY is the Azure resource key. Python
# port of ../../azureProvider.ts.

from __future__ import annotations

from typing import Any, List

from openai import AzureOpenAI

from agent.chat.providers.openai_shared import chat_complete
from agent.chat.types import LLMMessage
from config import env


class AzureOpenAIProvider:
    def __init__(self) -> None:
        self._deployment = env.azure_openai.deployment()
        self._client = AzureOpenAI(
            api_key=env.llm_api_key(),
            azure_endpoint=env.azure_openai.endpoint(),
            api_version=env.azure_openai.api_version,
            azure_deployment=self._deployment,
        )

    def complete(self, messages: List[LLMMessage]) -> Any:
        return chat_complete(self._client, self._deployment, messages, "azure")
