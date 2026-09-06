// Gemini adapter — REST call (Google AI Studio's generateContent endpoint),
// no SDK dependency needed. Implements the same provider-agnostic LLMProvider
// interface as the Anthropic/OpenAI adapters (see types.ts): adding this file
// plus one branch in index.ts is the whole integration, per the module doc
// comment in types.ts.
import { SYSTEM_PROMPT, TOOL_SCHEMAS } from '../toolSchemas.js';
import { env } from '../../../config.js';
import { llmErrorFromHttp } from './llmError.js';
import type { LLMMessage, LLMProvider, LLMResponse } from './types.js';

const DEFAULT_MODEL = 'gemini-flash-latest';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiFunctionCall {
  name: string;
  args?: Record<string, unknown>;
}

interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: { name: string; response: Record<string, unknown> };
  // Newer (3.x) Gemini models attach this to a response part and then
  // require it to be echoed back on that same part when it's replayed as
  // history in a later request — otherwise: HTTP 400 "Function call is
  // missing a thought_signature". See
  // https://ai.google.dev/gemini-api/docs/thought-signatures
  thoughtSignature?: string;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export class GeminiProvider implements LLMProvider {
  private apiKey = env.llmApiKeyOrThrow();
  private model = env.llmModel ?? DEFAULT_MODEL;

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: toGeminiContents(messages),
      tools: [
        {
          functionDeclarations: TOOL_SCHEMAS.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ],
    };

    const res = await fetch(`${API_BASE}/models/${this.model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw llmErrorFromHttp('gemini', res.status, detail);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const fnCallPart = parts.find((p) => p.functionCall);
    const fnCall = fnCallPart?.functionCall;
    if (fnCall) {
      return {
        type: 'tool_call',
        // Gemini doesn't return a call id the way Anthropic/OpenAI do — the
        // provider-agnostic layer only needs a unique opaque string that
        // round-trips through the tool-result turn (runChatTurn.ts matches by
        // toolName, not by this id), so one is synthesized here.
        toolCallId: `gemini-${fnCall.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        toolName: fnCall.name,
        args: fnCall.args ?? {},
        geminiThoughtSignature: fnCallPart.thoughtSignature,
      };
    }

    const text = parts.map((p) => p.text ?? '').join('');
    return { type: 'text', content: text };
  }
}

function toGeminiContents(messages: LLMMessage[]): GeminiContent[] {
  return messages.map((m): GeminiContent => {
    if (m.role === 'tool') {
      return {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: m.toolName ?? '',
              response: asResponseObject(m.content),
            },
          },
        ],
      };
    }
    if (m.role === 'assistant' && m.toolCallId) {
      return {
        role: 'model',
        parts: [
          {
            functionCall: { name: m.toolName ?? '', args: m.toolArgs ?? {} },
            thoughtSignature: m.geminiThoughtSignature,
          },
        ],
      };
    }
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
  });
}

// Gemini's functionResponse.response must be a JSON object — the tool results
// in this agent are always JSON.stringify()'d objects already, but this stays
// defensive rather than assuming that never changes.
function asResponseObject(content: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { result: parsed };
  } catch {
    return { result: content };
  }
}
