import { pbkdf2Sync, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import {
  CredentialAlreadyInWalletError,
  CredentialNotForThisAgentError,
  derivePublicKey,
  generateKeyPair,
  publicKeyToMultibase,
  selfIssueVC,
  signData,
  type DelegationGrantVC,
  type KeyPair,
  type SelfIssueOptions,
  type ServiceEndpoint,
  type SignedVC,
} from '@helixid/core';
import type { HelixClient } from '../client/HelixClient.js';

/** Same detection the grant schema's `superRefine` uses. */
function isDelegationGrantVC(vc: SignedVC): vc is SignedVC<DelegationGrantVC> {
  return Array.isArray(vc.type) && vc.type.includes('DelegationGrantCredential');
}

export interface WalletData {
  did: string;
  publicKeyHex: string;
  privateKeyHex: string;
  credentials: WalletCredential[];
  createdAt: string;
  updatedAt: string;
}

export interface WalletCredential {
  vcId: string;
  vcJson: string;
  type: string[];
  issuer?: string;
  subjectDid?: string;
  addedAt: string;
  updatedAt: string;
}

interface StoredWalletData {
  version: number;
  did: string;
  publicKeyHex: string;
  encryptedPrivateKey: string;
  authTag: string;
  iv: string;
  salt: string;
  credentials: WalletCredential[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentWalletOptions {
  client?: HelixClient;
  privateKeyHex?: string;
  did?: string;
  walletPath?: string;
  passphrase?: string;
  credentials?: WalletCredential[];
  createdAt?: string;
  updatedAt?: string;
}

export class AgentWallet {
  private readonly clientInstance: HelixClient | undefined;
  private privateKeyHex: string | undefined;
  private publicKeyHex: string | undefined;
  private didValue: string | undefined;
  private walletPath: string | undefined;
  private passphrase: string | undefined;
  private walletCredentials: WalletCredential[];
  private createdAt: string | undefined;
  private updatedAt: string | undefined;

  constructor(options: AgentWalletOptions = {}) {
    this.clientInstance = options.client;
    this.walletPath = options.walletPath;
    this.passphrase = options.passphrase;
    this.walletCredentials = options.credentials ?? [];
    this.createdAt = options.createdAt;
    this.updatedAt = options.updatedAt;
    if (options.privateKeyHex) {
      this.privateKeyHex = options.privateKeyHex;
      this.publicKeyHex = derivePublicKey(options.privateKeyHex);
    } else if (options.client) {
      const keyPair = generateKeyPair();
      this.privateKeyHex = keyPair.privateKey;
      this.publicKeyHex = keyPair.publicKey;
    }
    this.didValue = options.did;
  }

  get credentials(): SignedVC[] {
    return this.walletCredentials.map((credential) => JSON.parse(credential.vcJson) as SignedVC);
  }

  get did(): string {
    return this.getDID();
  }

  /** Exposed so free functions (e.g. `delegate()`) can reach the API without wallet needing to re-implement every client call itself. */
  get client(): HelixClient | undefined {
    return this.clientInstance;
  }

  getPublicKey(): string {
    if (!this.publicKeyHex) throw new Error('Wallet has no in-memory public key');
    return this.publicKeyHex;
  }

  getPrivateKeyHex(): string {
    if (!this.privateKeyHex) throw new Error('Wallet has no in-memory private key');
    return this.privateKeyHex;
  }

  getDID(): string {
    if (!this.didValue)
      throw new Error(
        'Wallet has no DID. Pass a live DID into AgentWallet or load an onboarded wallet file.',
      );
    return this.didValue;
  }

  async createDID(subjectType: 'agent' | 'user'): Promise<{ did: string }> {
    if (!this.clientInstance) throw new Error('Wallet has no HelixClient');
    return this.clientInstance.createDID({ subjectType });
  }

  async addService(endpoint: ServiceEndpoint): Promise<unknown> {
    if (!this.clientInstance) throw new Error('Wallet has no HelixClient');
    return this.clientInstance.addServiceEndpoint(this.getDID(), endpoint);
  }

  async removeService(endpointId: string): Promise<unknown> {
    if (!this.clientInstance) throw new Error('Wallet has no HelixClient');
    return this.clientInstance.removeServiceEndpoint(this.getDID(), endpointId);
  }

  async deactivate(reason = 'user_request'): Promise<void> {
    if (!this.clientInstance) throw new Error('Wallet has no HelixClient');
    await this.clientInstance.deactivateDID(this.getDID(), reason);
  }

  sign(data: string | Uint8Array): string {
    if (!this.privateKeyHex) throw new Error('Wallet has no in-memory private key');
    return signData(data, this.privateKeyHex);
  }

  async save(data: WalletData, passphrase: string, filePath: string): Promise<void> {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(data.privateKeyHex, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const payload: StoredWalletData = {
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

  private async saveCurrent(): Promise<void> {
    if (
      !this.didValue ||
      !this.publicKeyHex ||
      !this.privateKeyHex ||
      !this.passphrase ||
      !this.walletPath
    ) {
      throw new Error('Wallet is not loaded from a file');
    }
    const now = new Date().toISOString();
    await this.save(
      {
        did: this.didValue,
        publicKeyHex: this.publicKeyHex,
        privateKeyHex: this.privateKeyHex,
        credentials: this.walletCredentials,
        createdAt: this.createdAt ?? now,
        updatedAt: now,
      },
      this.passphrase,
      this.walletPath,
    );
    this.updatedAt = now;
  }

  async load(passphrase: string, filePath: string): Promise<WalletData> {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as StoredWalletData;
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
    } catch {
      throw new Error('Invalid passphrase or corrupted wallet');
    }
  }

  async getPrivateKey(passphrase: string, filePath: string): Promise<string> {
    const data = await this.load(passphrase, filePath);
    return data.privateKeyHex;
  }

  async addCredential(vc: SignedVC): Promise<void>;
  async addCredential(
    vcId: string,
    vcJson: string,
    filePath: string,
    passphrase: string,
  ): Promise<void>;
  async addCredential(
    vcOrId: SignedVC | string,
    vcJson?: string,
    filePath?: string,
    passphrase?: string,
  ): Promise<void> {
    if (typeof vcOrId !== 'string') {
      if (!this.didValue) {
        throw new Error(
          'Wallet has no DID. Pass a live DID into AgentWallet or load an onboarded wallet file.',
        );
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
      await this.recordConsentGrant(vc);
      return;
    }
    if (!vcJson || !filePath || !passphrase) {
      throw new Error('vcJson, filePath, and passphrase are required');
    }
    const vcId = vcOrId;
    const existing = await this.load(passphrase, filePath);
    const credential = AgentWallet.credentialFromVC(vcId, vcJson);
    const credentials = [...existing.credentials.filter((item) => item.vcId !== vcId), credential];
    await this.save(
      { ...existing, credentials, updatedAt: new Date().toISOString() },
      passphrase,
      filePath,
    );
  }

  /**
   * Emits `CONSENT_GRANTED` when the credential just stored is an SP-issued
   * delegation grant (spec §2a). Runs after the wallet write has already
   * succeeded and swallows everything: a wallet with no client attached, an API
   * that is down, or a grant with unexpected fields must all leave the stored
   * credential untouched and the caller none the wiser.
   */
  private async recordConsentGrant(vc: SignedVC): Promise<void> {
    if (!this.clientInstance || !isDelegationGrantVC(vc)) return;
    try {
      const subject = vc.credentialSubject;
      await this.clientInstance.recordConsentGrantedAudit({
        vcId: vc.id,
        agentDid: subject.id,
        issuer: vc.issuer,
        userDid: subject.userDid,
        scopes: subject.scopes,
        durability: subject.durability,
        grantedAt: new Date().toISOString(),
        source: 'sdk',
      });
    } catch {
      // Best-effort: the grant is already in the wallet.
    }
  }

  async selfIssueVC(options: SelfIssueOptions): Promise<SignedVC> {
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

  async updateCredential(
    vcId: string,
    vcJson: string,
    filePath: string,
    passphrase: string,
  ): Promise<void> {
    await this.addCredential(vcId, vcJson, filePath, passphrase);
  }

  async removeCredential(vcId: string, filePath: string, passphrase: string): Promise<void> {
    const existing = await this.load(passphrase, filePath);
    await this.save(
      {
        ...existing,
        credentials: existing.credentials.filter((item) => item.vcId !== vcId),
        updatedAt: new Date().toISOString(),
      },
      passphrase,
      filePath,
    );
  }

  async listCredentials(passphrase: string, filePath: string): Promise<WalletCredential[]> {
    return (await this.load(passphrase, filePath)).credentials;
  }

  async getCredential(
    vcId: string,
    passphrase: string,
    filePath: string,
  ): Promise<WalletCredential | null> {
    return (
      (await this.load(passphrase, filePath)).credentials.find((item) => item.vcId === vcId) ?? null
    );
  }

  /**
   * Selects the most recent DelegationGrantCredential issued by the given SP
   * for the given user. Grants are per (user, agent, service), so type/recency
   * filtering alone (getLatestCredential) cannot pick the right one.
   */
  selectGrant(issuerDid: string, userDid: string): WalletCredential | undefined {
    return this.walletCredentials
      .filter((item) => {
        if (!item.type.includes('DelegationGrantCredential')) return false;
        if (item.issuer !== issuerDid) return false;
        const parsed = JSON.parse(item.vcJson) as {
          credentialSubject?: { userDid?: unknown };
        };
        return parsed.credentialSubject?.userDid === userDid;
      })
      .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt))[0];
  }

  async getLatestCredential(
    options: { vcType?: string } | undefined,
    passphrase: string,
    filePath: string,
  ): Promise<WalletCredential | null> {
    const credentials = (await this.load(passphrase, filePath)).credentials
      .filter((item) => !options?.vcType || item.type.includes(options.vcType))
      .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt));
    return credentials[0] ?? null;
  }

  static credentialFromVC(vcId: string, vc: string | Record<string, unknown>): WalletCredential {
    const vcJson = typeof vc === 'string' ? vc : JSON.stringify(vc);
    const parsed = typeof vc === 'string' ? (JSON.parse(vc) as Record<string, unknown>) : vc;
    const subject =
      typeof parsed['credentialSubject'] === 'object' && parsed['credentialSubject'] !== null
        ? (parsed['credentialSubject'] as Record<string, unknown>)
        : {};
    const now = new Date().toISOString();
    const credential: WalletCredential = {
      vcId,
      vcJson,
      type: Array.isArray(parsed['type'])
        ? parsed['type'].filter((item): item is string => typeof item === 'string')
        : [],
      addedAt: now,
      updatedAt: now,
    };
    if (typeof parsed['issuer'] === 'string') credential.issuer = parsed['issuer'];
    if (typeof subject['id'] === 'string') credential.subjectDid = subject['id'];
    return credential;
  }

  static generateKeypair(): KeyPair {
    return generateKeyPair();
  }

  static fromKeypairAndCredential(
    keypair: KeyPair,
    vc: SignedVC | string | Record<string, unknown>,
  ): AgentWallet {
    const parsed =
      typeof vc === 'string' ? (JSON.parse(vc) as Record<string, unknown>) : vc;
    const vcId = typeof parsed['id'] === 'string' ? parsed['id'] : null;
    const subject =
      typeof parsed['credentialSubject'] === 'object' && parsed['credentialSubject'] !== null
        ? (parsed['credentialSubject'] as Record<string, unknown>)
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

  /**
   * `client` is optional and only used for best-effort audit emission (e.g.
   * `CONSENT_GRANTED`). Wallets loaded without one behave exactly as before.
   */
  static async create(
    walletPath: string,
    passphrase: string,
    client?: HelixClient,
  ): Promise<AgentWallet> {
    try {
      await access(walletPath);
      return AgentWallet.load(walletPath, passphrase, client);
    } catch {
      // file does not exist yet — create a new wallet
    }

    const keyPair = generateKeyPair();
    const now = new Date().toISOString();
    const data: WalletData = {
      did: `did:key:${publicKeyToMultibase(keyPair.publicKey)}`,
      publicKeyHex: keyPair.publicKey,
      privateKeyHex: keyPair.privateKey,
      credentials: [],
      createdAt: now,
      updatedAt: now,
    };
    await new AgentWallet().save(data, passphrase, walletPath);
    return AgentWallet.fromWalletData(data, walletPath, passphrase, client);
  }

  static async load(
    walletPath: string,
    passphrase: string,
    client?: HelixClient,
  ): Promise<AgentWallet> {
    const data = await new AgentWallet().load(passphrase, walletPath);
    return AgentWallet.fromWalletData(data, walletPath, passphrase, client);
  }

  private static fromWalletData(
    data: WalletData,
    walletPath: string,
    passphrase: string,
    client?: HelixClient,
  ): AgentWallet {
    return new AgentWallet({
      did: data.did,
      privateKeyHex: data.privateKeyHex,
      walletPath,
      passphrase,
      credentials: data.credentials,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      // exactOptionalPropertyTypes: only set the key when a client was given.
      ...(client ? { client } : {}),
    });
  }
}
