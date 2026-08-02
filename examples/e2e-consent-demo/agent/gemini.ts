import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type FunctionDeclaration,
} from '@google/genai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

export type PlannedToolName =
  | 'search_flights'
  | 'book_flight'
  | 'modify_booking'
  | 'search_hotels'
  | 'book_hotel';

export interface ChatContext {
  selectedFlight?: { flightId: string; origin?: string; destination?: string; departureDate?: string };
  selectedHotel?: { hotelId: string; city?: string };
  itinerary?: { origin: string; destination: string; departureDate?: string };
}

export type GeminiPlan =
  | { kind: 'message'; message: string }
  | { kind: 'tool_call'; tool: PlannedToolName; args: Record<string, string> };

export interface PlannerMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolPlanner {
  readonly provider: 'gemini' | 'openai' | 'anthropic' | 'deterministic';
  readonly model: string;
  plan(message: string, context: ChatContext, history?: PlannerMessage[]): Promise<GeminiPlan>;
}

export class DeterministicPlanner implements ToolPlanner {
  readonly provider = 'deterministic' as const;
  readonly model = 'scripted-fallback';

  async plan(message: string, context: ChatContext, history: PlannerMessage[] = []): Promise<GeminiPlan> {
    const priorUserText = history.filter((entry) => entry.role === 'user').map((entry) => entry.content).join(' ');
    const text = `${priorUserText} ${message}`.toLowerCase();
    const requestedDate = message.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? tomorrowIsoDate();
    const confirms = text.includes('yes') || text.includes('book') || text.includes('option 1');

    if (confirms && context.selectedHotel) {
      return validatePlannedToolCall(
        'book_hotel',
        { hotelId: context.selectedHotel.hotelId },
        context,
      );
    }
    if (confirms && context.selectedFlight) {
      return validatePlannedToolCall(
        'book_flight',
        { flightId: context.selectedFlight.flightId },
        context,
      );
    }
    if (text.includes('return')) {
      return validatePlannedToolCall(
        'search_flights',
        {
          origin: context.itinerary?.destination ?? 'DEL',
          destination: context.itinerary?.origin ?? 'TVM',
          departureDate: requestedDate,
        },
        context,
      );
    }
    if (text.includes('hotel')) {
      return validatePlannedToolCall('search_hotels', { city: 'DEL' }, context);
    }
    if (text.includes('flight') || text.includes('delhi') || text.includes('bombay') || text.includes('mumbai')) {
      const destination = text.includes('bombay') || text.includes('mumbai') || text.includes('bom') ? 'BOM' : 'DEL';
      return validatePlannedToolCall(
        'search_flights',
        { origin: 'TVM', destination, departureDate: requestedDate },
        // Deterministic fallback uses tomorrow when the scripted prompt omits a date.
        context,
      );
    }
    return {
      kind: 'message',
      message: 'Ask me for a flight from TVM to Delhi, a hotel in Delhi, or a return flight.',
    };
  }
}

function tomorrowIsoDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

const declarations: FunctionDeclaration[] = [
  {
    name: 'search_flights',
    description: 'Search available flights between an origin and destination city or airport code.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Origin city or airport code, for example TVM.' },
        destination: { type: 'string', description: 'Destination city or airport code, for example DEL.' },
        departureDate: { type: 'string', description: 'Travel date in YYYY-MM-DD format.' },
      },
      required: ['origin', 'destination', 'departureDate'],
      additionalProperties: false,
    },
  },
  {
    name: 'book_flight',
    description: 'Book a flight selected from the latest flight search results.',
    parametersJsonSchema: {
      type: 'object',
      properties: { flightId: { type: 'string' } },
      required: ['flightId'],
      additionalProperties: false,
    },
  },
  {
    name: 'modify_booking',
    description: 'Modify an existing flight booking.',
    parametersJsonSchema: {
      type: 'object',
      properties: { bookingId: { type: 'string' } },
      required: ['bookingId'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_hotels',
    description: 'Search available hotels in a city.',
    parametersJsonSchema: {
      type: 'object',
      properties: { city: { type: 'string', description: 'Destination city or airport code.' } },
      required: ['city'],
      additionalProperties: false,
    },
  },
  {
    name: 'book_hotel',
    description: 'Book a hotel selected from the latest hotel search results.',
    parametersJsonSchema: {
      type: 'object',
      properties: { hotelId: { type: 'string' } },
      required: ['hotelId'],
      additionalProperties: false,
    },
  },
];

const requiredArgs: Record<PlannedToolName, string[]> = {
  search_flights: ['origin', 'destination', 'departureDate'],
  book_flight: ['flightId'],
  modify_booking: ['bookingId'],
  search_hotels: ['city'],
  book_hotel: ['hotelId'],
};

export function validatePlannedToolCall(
  name: string | undefined,
  rawArgs: unknown,
  context: ChatContext,
): GeminiPlan {
  if (!name || !(name in requiredArgs)) throw new Error(`Gemini returned an unsupported tool: ${String(name)}`);
  const tool = name as PlannedToolName;
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
    throw new Error(`Gemini returned invalid arguments for ${tool}`);
  }
  const input = rawArgs as Record<string, unknown>;
  const args: Record<string, string> = {};
  for (const key of requiredArgs[tool]) {
    const value = input[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Gemini omitted required argument ${key} for ${tool}`);
    }
    args[key] = value.trim();
  }
  if (tool === 'search_flights') {
    args['origin'] = normalizePlace(args['origin']!);
    args['destination'] = normalizePlace(args['destination']!);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args['departureDate']!)) {
      throw new Error('Flight departureDate must use YYYY-MM-DD format');
    }
  }
  if (tool === 'search_hotels') args['city'] = normalizePlace(args['city']!);
  if (tool === 'book_flight' && args['flightId'] !== context.selectedFlight?.flightId) {
    throw new Error('The requested flight is not the flight selected from trusted search results');
  }
  if (tool === 'book_hotel' && args['hotelId'] !== context.selectedHotel?.hotelId) {
    throw new Error('The requested hotel is not the hotel selected from trusted search results');
  }
  return { kind: 'tool_call', tool, args };
}

function normalizePlace(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (['del', 'delhi', 'new delhi'].includes(normalized)) return 'DEL';
  if (['bom', 'bombay', 'mumbai'].includes(normalized)) return 'BOM';
  if (['tvm', 'trivandrum', 'thiruvananthapuram'].includes(normalized)) return 'TVM';
  return value.trim();
}

function systemPrompt(context: ChatContext): string {
  return [
    'You are a concise travel-planning agent for a HelixID consent demo.',
    'Use tools for every flight or hotel search, booking, or modification.',
    'TVM means Thiruvananthapuram and DEL means Delhi.',
    'When the user says option 1 or confirms a booking, use the selected item supplied in context.',
    'For a return-flight request, reverse the trusted itinerary supplied in context.',
    'Never invent a travel date. If the user did not provide the needed flight date, ask for it before calling search_flights.',
    'Never invent a flightId, hotelId, booking result, consent state, credential, or permission.',
    `Today is ${new Date().toISOString().slice(0, 10)}. Resolve dates such as "Aug 10th" against today and return YYYY-MM-DD.`,
    `Current trusted UI context: ${JSON.stringify(context)}`,
  ].join('\n');
}

export class GeminiPlanner implements ToolPlanner {
  readonly provider = 'gemini' as const;
  private readonly ai: GoogleGenAI;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async plan(message: string, context: ChatContext, history: PlannerMessage[] = []): Promise<GeminiPlan> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        ...history.map((entry) => ({
          role: entry.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: entry.content }],
        })),
        { role: 'user', parts: [{ text: message }] },
      ],
      config: {
        systemInstruction: systemPrompt(context),
        tools: [{ functionDeclarations: declarations }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        maxOutputTokens: 256,
        temperature: 0.1,
      },
    });

    const call = response.functionCalls?.[0];
    if (call) return validatePlannedToolCall(call.name, call.args, context);
    return { kind: 'message', message: response.text?.trim() || 'How can I help with your trip?' };
  }
}

export class OpenAIPlanner implements ToolPlanner {
  readonly provider = 'openai' as const;
  private readonly client: OpenAI;

  constructor(apiKey: string, readonly model: string) {
    this.client = new OpenAI({ apiKey });
  }

  async plan(message: string, context: ChatContext, history: PlannerMessage[] = []): Promise<GeminiPlan> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt(context) },
        ...history.map((entry) => ({ role: entry.role, content: entry.content } as const)),
        { role: 'user', content: message },
      ],
      tools: declarations.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name!,
          description: tool.description ?? '',
          parameters: tool.parametersJsonSchema as Record<string, unknown>,
        },
      })),
      tool_choice: 'auto',
    });
    const choice = response.choices[0]?.message;
    const call = choice?.tool_calls?.[0];
    if (call?.type === 'function') {
      let args: unknown;
      try { args = JSON.parse(call.function.arguments); } catch { throw new Error('OpenAI returned malformed tool arguments'); }
      return validatePlannedToolCall(call.function.name, args, context);
    }
    return { kind: 'message', message: choice?.content?.trim() || 'How can I help with your trip?' };
  }
}

export class AnthropicPlanner implements ToolPlanner {
  readonly provider = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(apiKey: string, readonly model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async plan(message: string, context: ChatContext, history: PlannerMessage[] = []): Promise<GeminiPlan> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 700,
      temperature: 0.1,
      system: systemPrompt(context),
      messages: [
        ...history.map((entry) => ({ role: entry.role, content: entry.content })),
        { role: 'user', content: message },
      ],
      tools: declarations.map((tool) => ({
        name: tool.name!,
        description: tool.description ?? '',
        input_schema: tool.parametersJsonSchema as Anthropic.Tool.InputSchema,
      })),
    });
    const call = response.content.find((part) => part.type === 'tool_use');
    if (call?.type === 'tool_use') return validatePlannedToolCall(call.name, call.input, context);
    const text = response.content.find((part) => part.type === 'text');
    return { kind: 'message', message: text?.type === 'text' ? text.text.trim() : 'How can I help with your trip?' };
  }
}

export function createToolPlanner(options: {
  provider: 'gemini' | 'openai' | 'anthropic';
  apiKey: string;
  model: string;
}): ToolPlanner {
  if (options.provider === 'openai') return new OpenAIPlanner(options.apiKey, options.model);
  if (options.provider === 'anthropic') return new AnthropicPlanner(options.apiKey, options.model);
  return new GeminiPlanner(options.apiKey, options.model);
}
