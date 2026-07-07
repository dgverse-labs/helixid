// agent — the HTTP surface the web app talks to. It is deliberately thin: one
// POST /chat that runs a single LLM turn-loop. No VP, VC, or DID ever appears in
// a request or response here; the web app has no idea HelixID exists.
import 'dotenv/config';
import express from 'express';
import { runChatTurn } from './chat/runChatTurn.js';
import { env } from '../config.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok', provider: env.llmProvider }));

interface ChatRequestBody {
  message?: string;
  conversationId?: string;
}

app.post('/chat', async (req, res) => {
  const { message, conversationId } = req.body as ChatRequestBody;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }
  try {
    const reply = await runChatTurn({
      message,
      conversationId: conversationId ?? 'default',
    });
    return res.json({ reply });
  } catch (error) {
    console.error('[Agent] chat turn failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'chat_failed' });
  }
});

app.listen(env.agentPort, '0.0.0.0', () => {
  console.log(`[Agent] Travel concierge agent listening on :${env.agentPort} (LLM_PROVIDER=${env.llmProvider}).`);
});
