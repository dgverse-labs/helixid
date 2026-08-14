// Helix Stay — the Hotel SP. Catalog: book:hotel. Entirely independent of the
// Airline SP: its own DID, its own status list, its own grants.
import { HOTEL } from '../helixid-config/index.js';
import { serveSp } from '../sp-shared/serve.js';

await serveSp(HOTEL);
