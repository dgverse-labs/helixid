#!/usr/bin/env node
import { runCli } from '../cli.js';
runCli(process.argv).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
});
//# sourceMappingURL=helix.js.map