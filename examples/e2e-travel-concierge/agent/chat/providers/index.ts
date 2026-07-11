import { AnthropicProvider } from './anthropicProvider.js';
import { OpenAIProvider } from './openaiProvider.js';
import { AzureOpenAIProvider } from './azureProvider.js';
import { env } from '../../../config.js';
import type { LLMProvider } from './types.js';

let cached: LLMProvider | undefined;

/** Selects the provider from LLM_PROVIDER (anthropic default, openai, or azure). */
export function getProvider(): LLMProvider {
  if (cached) return cached;
  switch (env.llmProvider) {
    case 'openai':
      cached = new OpenAIProvider();
      break;
    case 'azure':
      cached = new AzureOpenAIProvider();
      break;
    default:
      cached = new AnthropicProvider();
  }
  return cached;
}
