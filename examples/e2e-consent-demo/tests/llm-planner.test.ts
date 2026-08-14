import { beforeEach, describe, expect, it } from 'vitest';
import {
  acceptablePhrasing,
  clearPhraseCache,
  DeterministicPlanner,
  describePlanForHistory,
  phraseQuestion,
  ToolValidationError,
  validatePlannedToolCall,
  type PhraseRequest,
  type ToolPlanner,
} from '../agent/gemini.js';

describe('conversation history never teaches the model to emit tool-call templates', () => {
  // Regression: history used to store `Selected book_hotel with arguments
  // {"hotelId":"HS-DEL-2"}`, which the model then imitated as a TEXT reply
  // with the arguments blanked out.
  it('summarises a tool call as a plain sentence, with no JSON or argument dump', () => {
    const summary = describePlanForHistory({
      kind: 'tool_call',
      tool: 'book_hotel',
      args: { hotelId: 'HS-DEL-2' },
    });

    expect(summary).toBe('I booked hotel HS-DEL-2.');
    expect(summary).not.toContain('{');
    expect(summary).not.toContain('arguments');
    expect(summary).not.toContain('Selected');
  });

  it('describes every tool without leaking serialized arguments', () => {
    const plans = [
      { kind: 'tool_call', tool: 'search_flights', args: { origin: 'TVM', destination: 'DEL', departureDate: '2026-08-17' } },
      { kind: 'tool_call', tool: 'book_flight', args: { flightId: 'HA733' } },
      { kind: 'tool_call', tool: 'modify_booking', args: { bookingId: 'FLT-1' } },
      { kind: 'tool_call', tool: 'search_hotels', args: { city: 'DEL' } },
      { kind: 'tool_call', tool: 'book_hotel', args: { hotelId: 'HS-DEL-1' } },
    ] as const;

    for (const plan of plans) {
      const summary = describePlanForHistory(plan);
      expect(summary).not.toContain('{');
      expect(summary.startsWith('I ')).toBe(true);
    }
  });

  it('passes a plain message through unchanged', () => {
    expect(describePlanForHistory({ kind: 'message', message: 'What date?' })).toBe('What date?');
  });
});

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

  // Refusals must be distinguishable from "the provider is down", so the agent
  // can tell the user plainly instead of silently retrying on another planner.
  it('raises a typed ToolValidationError for refusals', () => {
    expect(() => validatePlannedToolCall('read_wallet', {}, {})).toThrow(ToolValidationError);
    expect(() =>
      validatePlannedToolCall('book_flight', { flightId: 'NOPE' }, { selectedFlight: { flightId: 'HA401' } }),
    ).toThrow(ToolValidationError);
    expect(() => validatePlannedToolCall('search_flights', { origin: 'TVM' }, {})).toThrow(
      ToolValidationError,
    );
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

  // Regression: booking anything other than the first result used to be
  // rejected outright, because only flights[0] was ever offered as selectable.
  it('accepts any flight the last search offered, not just the first', () => {
    expect(
      validatePlannedToolCall(
        'book_flight',
        { flightId: 'HA733' },
        {
          selectedFlight: { flightId: 'HA401' },
          flightOptions: [{ flightId: 'HA401' }, { flightId: 'HA733' }],
        },
      ),
    ).toMatchObject({ kind: 'tool_call', tool: 'book_flight', args: { flightId: 'HA733' } });
  });

  it('still rejects an id that was never offered, even with options present', () => {
    expect(() =>
      validatePlannedToolCall(
        'book_flight',
        { flightId: 'HA999' },
        {
          selectedFlight: { flightId: 'HA401' },
          flightOptions: [{ flightId: 'HA401' }, { flightId: 'HA733' }],
        },
      ),
    ).toThrow('not the flight selected');
  });

  it('accepts any hotel the last search offered', () => {
    expect(
      validatePlannedToolCall(
        'book_hotel',
        { hotelId: 'HS-DEL-2' },
        {
          selectedHotel: { hotelId: 'HS-DEL-1' },
          hotelOptions: [{ hotelId: 'HS-DEL-1' }, { hotelId: 'HS-DEL-2' }],
        },
      ),
    ).toMatchObject({ kind: 'tool_call', tool: 'book_hotel', args: { hotelId: 'HS-DEL-2' } });
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

  it('books a flight named explicitly by id rather than defaulting to the first', async () => {
    await expect(
      planner.plan('i need to book "HA733 · 19:05 · Helix Air"', {
        selectedFlight: { flightId: 'HA401' },
        flightOptions: [{ flightId: 'HA401' }, { flightId: 'HA733' }],
      }),
    ).resolves.toMatchObject({
      kind: 'tool_call',
      tool: 'book_flight',
      args: { flightId: 'HA733' },
    });
  });

  it('books the named hotel when both flight and hotel results are live', async () => {
    await expect(
      planner.plan('Yes, book hotel HS-DEL-2', {
        selectedFlight: { flightId: 'HA401' },
        flightOptions: [{ flightId: 'HA401' }, { flightId: 'HA733' }],
        selectedHotel: { hotelId: 'HS-DEL-1' },
        hotelOptions: [{ hotelId: 'HS-DEL-1' }, { hotelId: 'HS-DEL-2' }],
      }),
    ).resolves.toMatchObject({
      kind: 'tool_call',
      tool: 'book_hotel',
      args: { hotelId: 'HS-DEL-2' },
    });
  });

  it('routes a bare ordinal to the entity named in the message', async () => {
    const context = {
      selectedFlight: { flightId: 'HA401' },
      flightOptions: [{ flightId: 'HA401' }, { flightId: 'HA733' }],
      selectedHotel: { hotelId: 'HS-DEL-1' },
      hotelOptions: [{ hotelId: 'HS-DEL-1' }, { hotelId: 'HS-DEL-2' }],
    };

    await expect(planner.plan('Book hotel option 2', context)).resolves.toMatchObject({
      tool: 'book_hotel',
      args: { hotelId: 'HS-DEL-2' },
    });
    await expect(planner.plan('Book flight option 2', context)).resolves.toMatchObject({
      tool: 'book_flight',
      args: { flightId: 'HA733' },
    });
  });

  it('resolves an option by its position', async () => {
    await expect(
      planner.plan('Book option 2', {
        selectedFlight: { flightId: 'HA401' },
        flightOptions: [{ flightId: 'HA401' }, { flightId: 'HA733' }],
      }),
    ).resolves.toMatchObject({ tool: 'book_flight', args: { flightId: 'HA733' } });
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

describe('the model rewords questions but never chooses them', () => {
  const request: PhraseRequest = {
    question: 'How many travellers are going?',
    suggestions: ['Just me', '2 travellers'],
    known: { flyingTo: 'Delhi' },
  };

  beforeEach(() => clearPhraseCache());

  /** A planner that returns whatever the test wants, without a network call. */
  function stub(phrase?: (request: PhraseRequest) => Promise<string>): ToolPlanner {
    const base = new DeterministicPlanner();
    return phrase ? Object.assign(Object.create(Object.getPrototypeOf(base)), base, { phrase }) : base;
  }

  it('uses the reworded question when it is still one short question', async () => {
    const planner = stub(async () => 'Got it — how many of you are travelling to Delhi?');
    expect(await phraseQuestion(planner, request)).toBe('Got it — how many of you are travelling to Delhi?');
  });

  it('keeps the engine wording when the planner cannot reword at all', async () => {
    expect(await phraseQuestion(stub(), request)).toBe(request.question);
  });

  it('keeps the engine wording when the provider throws', async () => {
    // A quota or outage must change how the agent sounds and nothing else.
    const planner = stub(async () => { throw new Error('429 quota exhausted'); });
    expect(await phraseQuestion(planner, request)).toBe(request.question);
  });

  it('rejects a rewrite that asks for a second thing', () => {
    // Two questions would desynchronise the answer chips from what was asked.
    expect(acceptablePhrasing('How many travellers? And what is your budget?')).toBe(false);
  });

  it('rejects a rewrite that stopped being a question, grew a list, or ran long', () => {
    expect(acceptablePhrasing('Please tell me the number of travellers.')).toBe(false);
    expect(acceptablePhrasing('Who is going?\n- me\n- someone else')).toBe(false);
    expect(acceptablePhrasing(`${'x'.repeat(250)}?`)).toBe(false);
    expect(acceptablePhrasing('   ')).toBe(false);
  });

  it('accepts an ordinary conversational rewrite', () => {
    expect(acceptablePhrasing('Great, and how many of you are flying?')).toBe(true);
  });
});

describe('rewording stays inside the free-tier request budget', () => {
  beforeEach(() => clearPhraseCache());

  const request: PhraseRequest = {
    question: 'What date would you like to travel?',
    suggestions: ['2026-08-17'],
    known: { flyingTo: 'Delhi', flyingFrom: 'Thiruvananthapuram' },
  };

  function counting(reply: string): { planner: ToolPlanner; calls: () => number } {
    let calls = 0;
    const base = new DeterministicPlanner();
    const planner = Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
      phrase: async () => { calls += 1; return reply; },
    }) as ToolPlanner;
    return { planner, calls: () => calls };
  }

  it('asks the provider once per distinct question, however often it is asked', async () => {
    // The key allows 20 requests a day; a full demo run asks the same handful
    // of questions, so each one may cost at most a single call.
    const { planner, calls } = counting('And when are you hoping to fly?');

    const first = await phraseQuestion(planner, request);
    const second = await phraseQuestion(planner, request);

    expect(first).toBe('And when are you hoping to fly?');
    expect(second).toBe(first);
    expect(calls()).toBe(1);
  });

  it('rewords again when what the agent knows has changed', async () => {
    const { planner, calls } = counting('And when are you hoping to fly?');
    await phraseQuestion(planner, request);
    await phraseQuestion(planner, { ...request, known: { flyingTo: 'Mumbai' } });
    expect(calls()).toBe(2);
  });

  it('never caches a fallback, so one outage does not pin the scripted wording', async () => {
    let attempt = 0;
    const base = new DeterministicPlanner();
    const planner = Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
      phrase: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('429 quota exhausted');
        return 'And when are you hoping to fly?';
      },
    }) as ToolPlanner;

    expect(await phraseQuestion(planner, request)).toBe(request.question);
    expect(await phraseQuestion(planner, request)).toBe('And when are you hoping to fly?');
  });
});
