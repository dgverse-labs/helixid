import OpenAI from 'openai';
import { env } from '../../../config.js';
import type { LLMMessage, LLMProvider, LLMResponse } from './types.js';
import { chatComplete } from './openaiShared.js';

const MODEL = 'gpt-4o';

export class OpenAIProvider implements LLMProvider {
  private client = new OpenAI({ apiKey: env.llmApiKeyOrThrow() });

  complete(messages: LLMMessage[]): Promise<LLMResponse> {
    return chatComplete(this.client, MODEL, messages);
  }
}
