// Helix Air — the Airline SP. Catalog: book:flights, modify:booking.
import { AIRLINE } from '../helixid-config/index.js';
import { serveSp } from '../sp-shared/serve.js';

await serveSp(AIRLINE);
