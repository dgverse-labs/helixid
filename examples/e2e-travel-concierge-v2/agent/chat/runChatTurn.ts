// The one non-deterministic file. A real LLM decides, from the conversation,
// whether to call book_flight. The agent never authors the outcome sentence —
// the model does, from the real tool result — so the reply the user reads
// reflects a cryptographically enforced decision, not a canned string.
import { getProvider } from './providers/index.js';
import { bookFlight } from '../tools/bookFlight.js';
import type { LLMMessage } from './providers/types.js';

const conversations = new Map<string, LLMMessage[]>();

const TOOL_IMPLS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  book_flight: (args) =>
    bookFlight({
      flightId: String(args.flightId ?? ''),
      passengerName: String(args.passengerName ?? ''),
    }),
};

export interface ChatTurnInput {
  message: string;
  conversationId: string;
}

export async function runChatTurn({ message, conversationId }: ChatTurnInput): Promise<string> {
  const history = conversations.get(conversationId) ?? [];
  history.push({ role: 'user', content: message });

  const provider = getProvider();

  for (let i = 0; i < 4; i += 1) {
    const response = await provider.complete(history);

    if (response.type === 'text') {
      history.push({ role: 'assistant', content: response.content });
      conversations.set(conversationId, history);
      return response.content;
    }

    // Record the assistant's tool-call turn so the provider history stays valid.
    history.push({
      role: 'assistant',
      content: '',
      toolCallId: response.toolCallId,
      toolName: response.toolName,
      toolArgs: response.args,
    });

    const impl = TOOL_IMPLS[response.toolName];
    const result = impl
      ? await impl(response.args)
      : { error: `Unknown tool: ${response.toolName}` };

    history.push({
      role: 'tool',
      toolCallId: response.toolCallId,
      toolName: response.toolName,
      content: JSON.stringify(result),
    });
  }

  conversations.set(conversationId, history);
  return "Sorry, I wasn't able to complete that — could you rephrase?";
}
