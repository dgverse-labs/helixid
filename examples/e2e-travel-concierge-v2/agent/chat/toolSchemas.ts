// The single tool the LLM is allowed to call. Note this is the *agent-facing*
// schema (what the model sees): plain business arguments, no VP. The HelixID
// presentation is attached one layer down, in tools/bookFlight.ts, and enforced
// one layer down again by the MCP server. The model never sees a VP.

export const SYSTEM_PROMPT = [
  'You are a travel concierge agent. When the user asks to book a specific flight,',
  'call the book_flight tool with the flight identifier and passenger name.',
  'After the tool returns, tell the user plainly what happened — if the booking',
  'was refused, explain the reason from the tool result rather than inventing one.',
  'Do not claim a booking succeeded unless the tool result says so.',
].join(' ');

export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  };
}

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'book_flight',
    description: 'Book a specific flight by id for a named passenger.',
    parameters: {
      type: 'object',
      properties: {
        flightId: { type: 'string', description: 'Flight identifier, e.g. BA249' },
        passengerName: { type: 'string', description: 'Full name of the passenger' },
      },
      required: ['flightId', 'passengerName'],
    },
  },
];
