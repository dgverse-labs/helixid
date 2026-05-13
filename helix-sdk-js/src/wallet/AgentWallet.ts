import { pbkdf2Sync, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { deriveDID, derivePublicKey, generateKeyPair, signData, type ServiceEndpoint } from '@helix-id/core';
import type { HelixClient } from '../client/HelixClient.js';

export interface WalletData {
  did: string;
  publicKeyHex: string;
  privateKeyHex: string;
  vcId: string;
  vcJson: string;
  createdAt: string;
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
  vcId: string;
  vcJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentWalletOptions {
  client?: HelixClient;
  privateKeyHex?: string;
}

export class AgentWallet {
  private readonly client: HelixClient | undefined;
  private readonly privateKeyHex: string | undefined;
  private readonly publicKeyHex: string | undefined;
  private readonly did: string | undefined;

  constructor(options: AgentWalletOptions = {}) {
    this.client = options.client;
    if (options.privateKeyHex) {
      this.privateKeyHex = options.privateKeyHex;
      this.publicKeyHex = derivePublicKey(options.privateKeyHex);
    } else if (options.client) {
      const keyPair = generateKeyPair();
      this.privateKeyHex = keyPair.privateKey;
      this.publicKeyHex = keyPair.publicKey;
    }
    this.did = this.publicKeyHex ? deriveDID(this.publicKeyHex) : undefined;
  }

  getPublicKey(): string {
    if (!this.publicKeyHex) throw new Error('Wallet has no in-memory public key');
    return this.publicKeyHex;
  }

  getDID(): string {
    if (!this.did) throw new Error('Wallet has no in-memory DID');
    return this.did;
  }

  async createDID(subjectType: 'agent' | 'user'): Promise<{ did: string }> {
    if (!this.client) throw new Error('Wallet has no HelixClient');
    return this.client.createDID({ subjectType });
  }

  async addService(endpoint: ServiceEndpoint): Promise<unknown> {
    if (!this.client) throw new Error('Wallet has no HelixClient');
    return this.client.addServiceEndpoint(this.getDID(), endpoint);
  }

  async removeService(endpointId: string): Promise<unknown> {
    if (!this.client) throw new Error('Wallet has no HelixClient');
    return this.client.removeServiceEndpoint(this.getDID(), endpointId);
  }

  async deactivate(reason = 'user_request'): Promise<void> {
    if (!this.client) throw new Error('Wallet has no HelixClient');
    await this.client.deactivateDID(this.getDID(), reason);
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
      vcId: data.vcId,
      vcJson: data.vcJson,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
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
        vcId: parsed.vcId,
        vcJson: parsed.vcJson,
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

  async updateVC(newVcId: string, newVcJson: string, filePath: string, passphrase: string): Promise<void> {
    const existing = await this.load(passphrase, filePath);
    await this.save(
      { ...existing, vcId: newVcId, vcJson: newVcJson, updatedAt: new Date().toISOString() },
      passphrase,
      filePath,
    );
  }
}
