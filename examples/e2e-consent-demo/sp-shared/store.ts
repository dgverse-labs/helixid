// Per-SP persistence. Deliberately a plain JSON file — the point of this demo
// is the credential flow, not the datastore. What matters is that BOTH the
// signed grant and the updated status list are persisted together: without the
// grant the SP cannot revoke by VC later, and without the status list the
// revocation bit is lost on restart.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SignedVC, StatusListCredential } from '@helixid/sdk-js';

export interface StoredGrant {
  grantVC: SignedVC;
  agentDid: string;
  userDid: string;
  scopes: string[];
  durability: 'standing' | 'session';
  issuedAt: string;
}

export interface SpState {
  statusList: StatusListCredential;
  grants: StoredGrant[];
}

export class SpStore {
  private state: SpState;

  private constructor(
    private readonly filePath: string,
    state: SpState,
  ) {
    this.state = state;
  }

  static async open(filePath: string, initialStatusList: StatusListCredential): Promise<SpStore> {
    try {
      const raw = await readFile(filePath, 'utf8');
      return new SpStore(filePath, JSON.parse(raw) as SpState);
    } catch {
      const fresh: SpState = { statusList: initialStatusList, grants: [] };
      const store = new SpStore(filePath, fresh);
      await store.flush();
      return store;
    }
  }

  getStatusList(): StatusListCredential {
    return this.state.statusList;
  }

  getGrants(): StoredGrant[] {
    return this.state.grants;
  }

  /** Persists the issued grant and the status list it was allocated against. */
  async recordGrant(grant: StoredGrant, updatedStatusList: StatusListCredential): Promise<void> {
    this.state.grants.push(grant);
    this.state.statusList = updatedStatusList;
    await this.flush();
  }

  async replaceStatusList(statusList: StatusListCredential): Promise<void> {
    this.state.statusList = statusList;
    await this.flush();
  }

  private async flush(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
  }
}
