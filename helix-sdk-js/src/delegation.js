import { buildDelegationVC, NoCredentialInWalletError, } from '@helixid/core';
export async function delegate(options, wallet) {
    const fromVC = options.fromVC ?? wallet.credentials[0];
    if (!fromVC) {
        throw new NoCredentialInWalletError();
    }
    return buildDelegationVC({ ...options, fromVC }, {
        did: wallet.getDID(),
        privateKeyHex: wallet.getPrivateKeyHex(),
    });
}
//# sourceMappingURL=delegation.js.map