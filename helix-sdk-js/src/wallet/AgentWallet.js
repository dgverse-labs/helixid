import { pbkdf2Sync, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { CredentialAlreadyInWalletError, CredentialNotForThisAgentError, derivePublicKey, generateKeyPair, publicKeyToMultibase, selfIssueVC, signData, } from '@helixid/core';
export class AgentWallet {
    client;
    privateKeyHex;
    publicKeyHex;
    didValue;
    walletPath;
    passphrase;
    walletCredentials;
    createdAt;
    updatedAt;
    constructor(options = {}) {
        this.client = options.client;
        this.walletPath = options.walletPath;
        this.passphrase = options.passphrase;
        this.walletCredentials = options.credentials ?? [];
        this.createdAt = options.createdAt;
        this.updatedAt = options.updatedAt;
        if (options.privateKeyHex) {
            this.privateKeyHex = options.privateKeyHex;
            this.publicKeyHex = derivePublicKey(options.privateKeyHex);
        }
        else if (options.client) {
            const keyPair = generateKeyPair();
            this.privateKeyHex = keyPair.privateKey;
            this.publicKeyHex = keyPair.publicKey;
        }
        this.didValue = options.did;
    }
    get credentials() {
        return this.walletCredentials.map((credential) => JSON.parse(credential.vcJson));
    }
    get did() {
        return this.getDID();
    }
    getPublicKey() {
        if (!this.publicKeyHex)
            throw new Error('Wallet has no in-memory public key');
        return this.publicKeyHex;
    }
    getPrivateKeyHex() {
        if (!this.privateKeyHex)
            throw new Error('Wallet has no in-memory private key');
        return this.privateKeyHex;
    }
    getDID() {
        if (!this.didValue)
            throw new Error('Wallet has no DID. Pass a live DID into AgentWallet or load an onboarded wallet file.');
        return this.didValue;
    }
    async createDID(subjectType) {
        if (!this.client)
            throw new Error('Wallet has no HelixClient');
        return this.client.createDID({ subjectType });
    }
    async addService(endpoint) {
        if (!this.client)
            throw new Error('Wallet has no HelixClient');
        return this.client.addServiceEndpoint(this.getDID(), endpoint);
    }
    async removeService(endpointId) {
        if (!this.client)
            throw new Error('Wallet has no HelixClient');
        return this.client.removeServiceEndpoint(this.getDID(), endpointId);
    }
    async deactivate(reason = 'user_request') {
        if (!this.client)
            throw new Error('Wallet has no HelixClient');
        await this.client.deactivateDID(this.getDID(), reason);
    }
    sign(data) {
        if (!this.privateKeyHex)
            throw new Error('Wallet has no in-memory private key');
        return signData(data, this.privateKeyHex);
    }
    async save(data, passphrase, filePath) {
        const salt = randomBytes(16);
        const iv = randomBytes(12);
        const key = pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');
        const cipher = createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([cipher.update(data.privateKeyHex, 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();
        const payload = {
            version: 1,
            did: data.did,
            publicKeyHex: data.publicKeyHex,
            encryptedPrivateKey: encrypted.toString('hex'),
            authTag: authTag.toString('hex'),
            iv: iv.toString('hex'),
            salt: salt.toString('hex'),
            credentials: data.credentials,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
        };
        await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    }
    async saveCurrent() {
        if (!this.didValue ||
            !this.publicKeyHex ||
            !this.privateKeyHex ||
            !this.passphrase ||
            !this.walletPath) {
            throw new Error('Wallet is not loaded from a file');
        }
        const now = new Date().toISOString();
        await this.save({
            did: this.didValue,
            publicKeyHex: this.publicKeyHex,
            privateKeyHex: this.privateKeyHex,
            credentials: this.walletCredentials,
            createdAt: this.createdAt ?? now,
            updatedAt: now,
        }, this.passphrase, this.walletPath);
        this.updatedAt = now;
    }
    async load(passphrase, filePath) {
        const raw = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        try {
            const key = pbkdf2Sync(passphrase, Buffer.from(parsed.salt, 'hex'), 100_000, 32, 'sha256');
            const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'hex'));
            decipher.setAuthTag(Buffer.from(parsed.authTag, 'hex'));
            const decrypted = Buffer.concat([
                decipher.update(Buffer.from(parsed.encryptedPrivateKey, 'hex')),
                decipher.final(),
            ]);
            return {
                did: parsed.did,
                publicKeyHex: parsed.publicKeyHex,
                privateKeyHex: decrypted.toString('utf8'),
                credentials: parsed.credentials,
                createdAt: parsed.createdAt,
                updatedAt: parsed.updatedAt,
            };
        }
        catch {
            throw new Error('Invalid passphrase or corrupted wallet');
        }
    }
    async getPrivateKey(passphrase, filePath) {
        const data = await this.load(passphrase, filePath);
        return data.privateKeyHex;
    }
    async addCredential(vcOrId, vcJson, filePath, passphrase) {
        if (typeof vcOrId !== 'string') {
            if (!this.didValue) {
                throw new Error('Wallet has no DID. Pass a live DID into AgentWallet or load an onboarded wallet file.');
            }
            const vc = vcOrId;
            if (vc.credentialSubject.id !== this.didValue) {
                throw new CredentialNotForThisAgentError();
            }
            if (this.walletCredentials.some((item) => item.vcId === vc.id)) {
                throw new CredentialAlreadyInWalletError();
            }
            this.walletCredentials = [...this.walletCredentials, AgentWallet.credentialFromVC(vc.id, vc)];
            await this.saveCurrent();
            return;
        }
        if (!vcJson || !filePath || !passphrase) {
            throw new Error('vcJson, filePath, and passphrase are required');
        }
        const vcId = vcOrId;
        const existing = await this.load(passphrase, filePath);
        const credential = AgentWallet.credentialFromVC(vcId, vcJson);
        const credentials = [...existing.credentials.filter((item) => item.vcId !== vcId), credential];
        await this.save({ ...existing, credentials, updatedAt: new Date().toISOString() }, passphrase, filePath);
    }
    async selfIssueVC(options) {
        if (!this.didValue || !this.privateKeyHex) {
            throw new Error('Wallet has no DID or private key');
        }
        const vc = await selfIssueVC(options, {
            did: this.didValue,
            privateKeyHex: this.privateKeyHex,
        });
        await this.addCredential(vc);
        return vc;
    }
    async updateCredential(vcId, vcJson, filePath, passphrase) {
        await this.addCredential(vcId, vcJson, filePath, passphrase);
    }
    async removeCredential(vcId, filePath, passphrase) {
        const existing = await this.load(passphrase, filePath);
        await this.save({
            ...existing,
            credentials: existing.credentials.filter((item) => item.vcId !== vcId),
            updatedAt: new Date().toISOString(),
        }, passphrase, filePath);
    }
    async listCredentials(passphrase, filePath) {
        return (await this.load(passphrase, filePath)).credentials;
    }
    async getCredential(vcId, passphrase, filePath) {
        return ((await this.load(passphrase, filePath)).credentials.find((item) => item.vcId === vcId) ?? null);
    }
    async getLatestCredential(options, passphrase, filePath) {
        const credentials = (await this.load(passphrase, filePath)).credentials
            .filter((item) => !options?.vcType || item.type.includes(options.vcType))
            .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt));
        return credentials[0] ?? null;
    }
    static credentialFromVC(vcId, vc) {
        const vcJson = typeof vc === 'string' ? vc : JSON.stringify(vc);
        const parsed = typeof vc === 'string' ? JSON.parse(vc) : vc;
        const subject = typeof parsed['credentialSubject'] === 'object' && parsed['credentialSubject'] !== null
            ? parsed['credentialSubject']
            : {};
        const now = new Date().toISOString();
        const credential = {
            vcId,
            vcJson,
            type: Array.isArray(parsed['type'])
                ? parsed['type'].filter((item) => typeof item === 'string')
                : [],
            addedAt: now,
            updatedAt: now,
        };
        if (typeof parsed['issuer'] === 'string')
            credential.issuer = parsed['issuer'];
        if (typeof subject['id'] === 'string')
            credential.subjectDid = subject['id'];
        return credential;
    }
    static generateKeypair() {
        return generateKeyPair();
    }
    static fromKeypairAndCredential(keypair, vc) {
        const parsed = typeof vc === 'string' ? JSON.parse(vc) : vc;
        const vcId = typeof parsed['id'] === 'string' ? parsed['id'] : null;
        const subject = typeof parsed['credentialSubject'] === 'object' && parsed['credentialSubject'] !== null
            ? parsed['credentialSubject']
            : {};
        const did = `did:key:${publicKeyToMultibase(keypair.publicKey)}`;
        if (!vcId) {
            throw new Error('VC has no id');
        }
        if (subject['id'] !== did) {
            throw new CredentialNotForThisAgentError();
        }
        return new AgentWallet({
            did,
            privateKeyHex: keypair.privateKey,
            credentials: [AgentWallet.credentialFromVC(vcId, vc)],
        });
    }
    static async create(walletPath, passphrase) {
        try {
            await access(walletPath);
            return AgentWallet.load(walletPath, passphrase);
        }
        catch {
            // file does not exist yet — create a new wallet
        }
        const keyPair = generateKeyPair();
        const now = new Date().toISOString();
        const data = {
            did: `did:key:${publicKeyToMultibase(keyPair.publicKey)}`,
            publicKeyHex: keyPair.publicKey,
            privateKeyHex: keyPair.privateKey,
            credentials: [],
            createdAt: now,
            updatedAt: now,
        };
        await new AgentWallet().save(data, passphrase, walletPath);
        return AgentWallet.fromWalletData(data, walletPath, passphrase);
    }
    static async load(walletPath, passphrase) {
        const data = await new AgentWallet().load(passphrase, walletPath);
        return AgentWallet.fromWalletData(data, walletPath, passphrase);
    }
    static fromWalletData(data, walletPath, passphrase) {
        return new AgentWallet({
            did: data.did,
            privateKeyHex: data.privateKeyHex,
            walletPath,
            passphrase,
            credentials: data.credentials,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
        });
    }
}
//# sourceMappingURL=AgentWallet.js.map
