import { readFile, writeFile } from 'node:fs/promises';
import { requirePassphrase } from '../lib/env.js';
import { parseStatusListFile, revokeCredentialInStatusList } from '../lib/issuer-ops.js';
import { error, success } from '../lib/output.js';
import { loadIssuerKeyMaterial } from '../lib/wallet.js';
export async function runRevoke(options) {
    const passphrase = requirePassphrase();
    const issuer = await loadIssuerKeyMaterial(options.wallet, passphrase);
    let statusListRaw;
    try {
        statusListRaw = JSON.parse(await readFile(options.statusList, 'utf8'));
    }
    catch {
        error(`Status list file not found or invalid: ${options.statusList}`);
    }
    const statusList = parseStatusListFile(statusListRaw);
    try {
        const { statusList: updatedList, index, previousBit } = await revokeCredentialInStatusList({
            issuer,
            statusList,
            vcId: options.vcId,
        });
        await writeFile(options.statusList, JSON.stringify(updatedList, null, 2), 'utf8');
        success('VC revoked');
        console.log('');
        console.log(`VC ID:        ${options.vcId}`);
        console.log(`Status index: ${index}`);
        console.log(`Bit flipped:  ${previousBit} → 1`);
        console.log('');
        console.log(`Push ${options.statusList} to your HTTPS server.`);
        console.log('Verifiers will see the revocation on next StatusList fetch.');
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Revocation failed';
        error(message);
    }
}
//# sourceMappingURL=revoke.js.map