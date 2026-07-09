// search_flights — requires the read:catalog scope, which both personas carry.
// It's here so the Search Agent is a real agent that can do something (search)
// while still being refused booking, sharpening the scope contrast.
import { TOOLS } from '../../config.js';
import type { Persona } from '../../personas/types.js';
import { callProtectedTool, type ProtectedResult } from './protectedCall.js';

export interface SearchFlightsArgs {
  origin: string;
  destination: string;
  date?: string;
}

export function searchFlights(persona: Persona, args: SearchFlightsArgs): Promise<ProtectedResult> {
  return callProtectedTool(persona, TOOLS.SEARCH, {
    origin: args.origin,
    destination: args.destination,
    date: args.date ?? '',
  });
}
