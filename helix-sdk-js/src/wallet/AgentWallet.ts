import { pbkdf2Sync, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

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

export class AgentWallet {
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
      updatedAt: data.updatedAt
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
        decipher.final()
      ]);

      return {
        did: parsed.did,
        publicKeyHex: parsed.publicKeyHex,
        privateKeyHex: decrypted.toString('utf8'),
        vcId: parsed.vcId,
        vcJson: parsed.vcJson,
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt
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
      filePath
    );
  }
}
