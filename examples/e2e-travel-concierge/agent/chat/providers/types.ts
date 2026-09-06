// Provider-agnostic LLM interface (v1 SPEC §5.7). The rest of the agent talks to
// this shape; the Anthropic and OpenAI adapters translate to/from it. Adding a
// provider means adding one file that implements LLMProvider — nothing else in
// the agent changes.

export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool';
  /** Text for user/assistant text turns; JSON tool result for tool turns. */
  content: string;
  /** Set on an assistant tool-call turn and on the matching tool-result turn. */
  toolCallId?: string;
  toolName?: string;
  /** Set on an assistant tool-call turn: the arguments the model chose. */
  toolArgs?: Record<string, unknown>;
  /**
   * Gemini-only: the `thoughtSignature` Gemini attaches to a functionCall
   * part. Newer Gemini models reject a follow-up request whose replayed
   * history includes a functionCall turn without this signature (see
   * geminiProvider.ts) — other providers ignore this field.
   */
  geminiThoughtSignature?: string;
}

export interface ToolCallRequest {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  geminiThoughtSignature?: string;
}

export interface TextResponse {
  type: 'text';
  content: string;
}

export type LLMResponse = ToolCallRequest | TextResponse;

export interface LLMProvider {
  complete(messages: LLMMessage[]): Promise<LLMResponse>;
}
