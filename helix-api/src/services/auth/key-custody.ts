// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// See docs/proposal-hosted-instance.md ("Private key storage (interim,
// pre-KMS)"). This is explicitly an interim, single-shared-key model: one
// AES-256-GCM master key (env var) encrypts every account's private key.
// Anyone with that env var can decrypt every account's key — an accepted
// trade-off for now, not a hidden gap.
//
// All encrypt/decrypt/sign operations for hosted-account keys go through
// this interface rather than being called directly at each call site, so
// swapping in real KMS + per-tenant envelope encryption + key rotation
// later is a one-file change instead of a hunt-and-replace across the
// codebase. KMS-backed custody and rotation are explicitly deferred.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { generateKeyPair, signData, type KeyPair } from '@helixid/core';

const ALGORITHM = 'aes-256-gcm';

export interface EncryptedKeyMaterial {
  encryptedPrivateKey: string;
  iv: string;
  authTag: string;
  algorithm: string;
}

export interface IKeyCustody {
  /** Generates a fresh Ed25519 keypair and encrypts the private key at rest. */
  generateAndEncrypt(): { publicKey: string; encrypted: EncryptedKeyMaterial };
  /** Decrypts and signs in one call — the plaintext private key never leaves this module. */
  sign(data: string, encrypted: EncryptedKeyMaterial): string;
}

/**
 * AES-256-GCM implementation backed by a single 32-byte master key.
 * `masterKeyHex` must be 64 hex chars (32 bytes). See config's
 * `HOSTED_KEY_ENCRYPTION_KEY` — unset in dev falls back to a random
 * per-process key generated in server.ts (fine for local dev; means
 * encrypted rows don't survive a restart in that mode).
 */
export class AesGcmKeyCustody implements IKeyCustody {
  private readonly masterKey: Buffer;

  constructor(masterKeyHex: string) {
    if (!/^[0-9a-fA-F]{64}$/.test(masterKeyHex)) {
      throw new Error('AesGcmKeyCustody: master key must be 64 hex chars (32 bytes)');
    }
    this.masterKey = Buffer.from(masterKeyHex, 'hex');
  }

  generateAndEncrypt(): { publicKey: string; encrypted: EncryptedKeyMaterial } {
    const keyPair: KeyPair = generateKeyPair();
    const encrypted = this.encrypt(keyPair.privateKey);
    return { publicKey: keyPair.publicKey, encrypted };
  }

  sign(data: string, encrypted: EncryptedKeyMaterial): string {
    const privateKeyHex = this.decrypt(encrypted);
    return signData(data, privateKeyHex);
  }

  private encrypt(plaintextHex: string): EncryptedKeyMaterial {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintextHex, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      encryptedPrivateKey: ciphertext.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      algorithm: ALGORITHM,
    };
  }

  private decrypt(encrypted: EncryptedKeyMaterial): string {
    const decipher = createDecipheriv(ALGORITHM, this.masterKey, Buffer.from(encrypted.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.encryptedPrivateKey, 'hex')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
