from __future__ import annotations

from typing import Any, Optional

from config import env

_cached: Optional[Any] = None


def get_provider() -> Any:
    """Selects the provider from LLM_PROVIDER (anthropic default, openai, azure, or gemini)."""
    global _cached
    if _cached is not None:
        return _cached

    if env.llm_provider == "openai":
        from agent.chat.providers.openai_provider import OpenAIProvider

        _cached = OpenAIProvider()
    elif env.llm_provider == "azure":
        from agent.chat.providers.azure_provider import AzureOpenAIProvider

        _cached = AzureOpenAIProvider()
    elif env.llm_provider == "gemini":
        from agent.chat.providers.gemini_provider import GeminiProvider

        _cached = GeminiProvider()
    else:
        from agent.chat.providers.anthropic_provider import AnthropicProvider

        _cached = AnthropicProvider()
    return _cached
