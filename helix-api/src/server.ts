import Fastify from 'fastify';
import vpRoutes from './routes/vp/index.js';
import agentRoutes from './routes/agent/index.js';
import { VPRepository } from './repositories/vp.repository.js';
import { AgentRepository } from './repositories/agent.repository.js';
import { ServiceRegistryRepository } from './services/vp/ServiceRegistryRepository.js';
import { VPService } from './services/vp/vp.service.js';
import { AgentService } from './services/agent/agent.service.js';
import type { IAuditLogger } from '@helix-id/core';
import type { IDIDService } from './services/did/IDIDService.js';
import type { IVCService, IssueVCInput } from './services/vc/IVCService.js';

class StdoutAuditLogger implements IAuditLogger {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  log(_event: import('@helix-id/core').AuditEvent, _payload: Record<string, unknown>): void {
    return;
  }
}

class DevDIDService implements IDIDService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createDID(_publicKeyHex: string, _subjectType: 'agent' | 'user', _domains: string[], _requestId: string): Promise<{ did: string; hederaTransactionId: string }> {
    return { did: `did:hedera:testnet:${Date.now()}`, hederaTransactionId: 'mock-tx-1' };
  }
  async resolveDID(did: string): Promise<any> {
    if (did.startsWith('did:test:')) {
      return { id: did, verificationMethod: [{ id: `${did}#key-1`, type: 'Ed25519VerificationKey2020', publicKeyHex: 'abc123' }] };
    }
    throw new Error('DID service is not configured');
  }
}

class DevVCService implements IVCService {
  async findActiveBySubjectDid(_did: string, vcType?: string): Promise<Record<string, unknown> | null> {
    return {
      id: 'vc:test:1',
      type: ['VerifiableCredential', vcType || 'HelixAgentCredential'],
      credentialSubject: { id: _did }
    };
  }
  async getVCStatus(): Promise<'active'> {
    return 'active';
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async issueVC(input: IssueVCInput): Promise<Record<string, unknown>> {
    return { id: `vc:${Date.now()}`, type: ['VerifiableCredential'], credentialSubject: { id: input.subjectDid } };
  }
}

const app = Fastify({ logger: true });
const vpService = new VPService(
  new VPRepository(),
  new DevDIDService(),
  new DevVCService(),
  new ServiceRegistryRepository(),
  new StdoutAuditLogger()
);
const agentService = new AgentService(new AgentRepository(), new DevDIDService(), new DevVCService(), new StdoutAuditLogger());

app.get('/health', async () => ({ status: 'ok', version: '0.1.0' }));
await app.register(vpRoutes, { prefix: '/v1/vp', vpService });
await app.register(agentRoutes, { prefix: '/v1', agentService });

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
