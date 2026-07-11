import { AzureOpenAI } from 'openai';
import { env } from '../../../config.js';
import type { LLMMessage, LLMProvider, LLMResponse } from './types.js';
import { chatComplete } from './openaiShared.js';

// Azure OpenAI uses the same wire protocol as OpenAI; the deployment name plays
// the role of the model. LLM_API_KEY is the Azure resource key.
export class AzureOpenAIProvider implements LLMProvider {
  private readonly deployment = env.azureOpenAI.deploymentOrThrow();
  private client = new AzureOpenAI({
    apiKey: env.llmApiKeyOrThrow(),
    endpoint: env.azureOpenAI.endpointOrThrow(),
    apiVersion: env.azureOpenAI.apiVersion,
    deployment: this.deployment,
  });

  complete(messages: LLMMessage[]): Promise<LLMResponse> {
    return chatComplete(this.client, this.deployment, messages);
  }
}
