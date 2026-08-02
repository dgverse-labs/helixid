import { describe, expect, it } from 'vitest';
import { DeterministicPlanner, validatePlannedToolCall } from '../agent/gemini.js';

describe('provider-neutral LLM tool-call validation', () => {
  it('accepts an allowlisted search with required string arguments', () => {
    expect(
      validatePlannedToolCall(
        'search_flights',
        { origin: 'TVM', destination: 'DEL', departureDate: '2026-08-15', ignored: 'not forwarded' },
        {},
      ),
    ).toEqual({
      kind: 'tool_call',
      tool: 'search_flights',
      args: { origin: 'TVM', destination: 'DEL', departureDate: '2026-08-15' },
    });
  });

  it('rejects tools outside the allowlist', () => {
    expect(() => validatePlannedToolCall('read_wallet', {}, {})).toThrow('unsupported tool');
  });

  it('rejects an invented flight instead of trusting model arguments', () => {
    expect(() =>
      validatePlannedToolCall(
        'book_flight',
        { flightId: 'INVENTED' },
        { selectedFlight: { flightId: 'HA401' } },
      ),
    ).toThrow('not the flight selected');
  });

  it('accepts the flight selected from trusted search results', () => {
    expect(
      validatePlannedToolCall(
        'book_flight',
        { flightId: 'HA401' },
        { selectedFlight: { flightId: 'HA401' } },
      ),
    ).toMatchObject({ kind: 'tool_call', tool: 'book_flight' });
  });
});

describe('deterministic no-key fallback', () => {
  const planner = new DeterministicPlanner();

  it('plans the outbound search without an API key', async () => {
    await expect(planner.plan('Help me find a flight to Delhi on 2026-08-15', {})).resolves.toMatchObject({
      kind: 'tool_call',
      tool: 'search_flights',
      args: { origin: 'TVM', destination: 'DEL', departureDate: '2026-08-15' },
    });
  });

  it('books only the trusted selected option', async () => {
    await expect(
      planner.plan('Yes, book option 1', { selectedFlight: { flightId: 'HA401' } }),
    ).resolves.toMatchObject({
      kind: 'tool_call',
      tool: 'book_flight',
      args: { flightId: 'HA401' },
    });
  });

  it('reverses the trusted itinerary for a return flight', async () => {
    await expect(
      planner.plan('Find my return flight on 2026-08-20', { itinerary: { origin: 'TVM', destination: 'DEL' } }),
    ).resolves.toMatchObject({
      args: { origin: 'DEL', destination: 'TVM', departureDate: '2026-08-20' },
    });
  });

  it('uses prior user turns when a follow-up only supplies the date', async () => {
    await expect(
      planner.plan(
        '2026-08-15',
        {},
        [
          { role: 'user', content: 'Are there flights from TVM to Bombay?' },
          { role: 'assistant', content: 'What date would you like to travel?' },
        ],
      ),
    ).resolves.toMatchObject({
      tool: 'search_flights',
      args: { origin: 'TVM', destination: 'BOM', departureDate: '2026-08-15' },
    });
  });
});
