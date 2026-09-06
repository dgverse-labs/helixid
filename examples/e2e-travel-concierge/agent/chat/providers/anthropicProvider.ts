import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, TOOL_SCHEMAS } from '../toolSchemas.js';
import { env } from '../../../config.js';
import { llmErrorFromSdkError } from './llmError.js';
import type { LLMMessage, LLMProvider, LLMResponse } from './types.js';

const MODEL = 'claude-sonnet-5';

export class AnthropicProvider implements LLMProvider {
  private client = new Anthropic({ apiKey: env.llmApiKeyOrThrow() });

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    const res = await this.client.messages
      .create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: toAnthropicMessages(messages),
        tools: TOOL_SCHEMAS.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Tool.InputSchema,
        })),
      })
      .catch((err: unknown) => {
        throw llmErrorFromSdkError('anthropic', err);
      });

    const toolUse = res.content.find((b) => b.type === 'tool_use');
    if (toolUse && toolUse.type === 'tool_use') {
      return {
        type: 'tool_call',
        toolCallId: toolUse.id,
        toolName: toolUse.name,
        args: (toolUse.input ?? {}) as Record<string, unknown>,
      };
    }

    const text = res.content.find((b) => b.type === 'text');
    return { type: 'text', content: text && text.type === 'text' ? text.text : '' };
  }
}

// Our provider-agnostic history already alternates user / assistant, so each
// tool_use is its own assistant turn and each tool result its own user turn —
// exactly what the Anthropic API expects.
function toAnthropicMessages(messages: LLMMessage[]): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId ?? '',
            content: m.content,
          },
        ],
      };
    }
    if (m.role === 'assistant' && m.toolCallId) {
      return {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: m.toolCallId,
            name: m.toolName ?? '',
            input: m.toolArgs ?? {},
          },
        ],
      };
    }
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
  });
}
