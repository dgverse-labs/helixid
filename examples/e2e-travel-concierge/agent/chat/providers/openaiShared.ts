// Shared chat-completion logic for the OpenAI-compatible providers (plain OpenAI
// and Azure OpenAI). AzureOpenAI extends OpenAI, so the same code drives both —
// only the client instance and the model/deployment name differ.
import type OpenAI from 'openai';
import { SYSTEM_PROMPT, TOOL_SCHEMAS } from '../toolSchemas.js';
import { llmErrorFromSdkError } from './llmError.js';
import type { LLMMessage, LLMResponse } from './types.js';

export async function chatComplete(
  client: OpenAI,
  model: string,
  messages: LLMMessage[],
  providerLabel: string,
): Promise<LLMResponse> {
  const res = await client.chat.completions
    .create({
      model,
      messages: toOpenAIMessages(messages),
      tools: TOOL_SCHEMAS.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    })
    .catch((err: unknown) => {
      throw llmErrorFromSdkError(providerLabel, err);
    });

  const choice = res.choices[0]?.message;
  const toolCall = choice?.tool_calls?.[0];
  if (toolCall && toolCall.type === 'function') {
    return {
      type: 'tool_call',
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      args: JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>,
    };
  }

  return { type: 'text', content: choice?.content ?? '' };
}

export function toOpenAIMessages(messages: LLMMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  const mapped: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];
  for (const m of messages) {
    if (m.role === 'tool') {
      mapped.push({ role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content });
    } else if (m.role === 'assistant' && m.toolCallId) {
      mapped.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: m.toolCallId,
            type: 'function',
            function: { name: m.toolName ?? '', arguments: JSON.stringify(m.toolArgs ?? {}) },
          },
        ],
      });
    } else if (m.role === 'assistant') {
      mapped.push({ role: 'assistant', content: m.content });
    } else {
      mapped.push({ role: 'user', content: m.content });
    }
  }
  return mapped;
}
