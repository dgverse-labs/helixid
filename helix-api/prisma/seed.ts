import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Prisma 7 requires a driver adapter. We use @prisma/adapter-pg.
const connectionString = process.env.DATABASE_URL || 'postgresql://helixid_test:helixid_test@localhost:5432/helixid_test';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

async function main() {
  const prisma = new PrismaClient({ adapter });

  console.log('Seeding database with real Hedera DIDs and VCs...');

  const agentDid = 'did:hedera:testnet:42ubDg7iWCsGJTemHKEUWDQifEHM3KPHTmQgN5Hofogm_0.0.8050123';
  const issuerDid = 'did:hedera:testnet:3GyeSet8RyahYaPyUoSmD9dfftpCmtZDmKwjGdzdBnkq_0.0.7553278';

  // 1. Create a Service
  await prisma.serviceRegistry.upsert({
    where: { serviceName: 'amazon' },
    update: {},
    create: {
      serviceName: 'amazon',
      displayName: 'Amazon Retail',
      verifiedDomain: 'amazon.com',
      publicKeyMultibase: 'z6MkgYvYFsCcNycDE9iJ6shfX88oZ3LGH5x9R673d39R',
      apiEndpoint: 'https://api.amazon.com/helix-verify',
      metadata: '{}',
      active: true
    }
  });

  // 2. Create Agent DID Record
  await prisma.did.upsert({
    where: { did: agentDid },
    update: {},
    create: {
      did: agentDid,
      publicKeyHex: '2d101af27241b586e5ff220d4b4f66d75abc5079b33eab2e16970e5a250a8cca',
      subjectType: 'agent'
    }
  });
  
  // 3. Create Issuer DID Record (Platform Manager)
  await prisma.did.upsert({
    where: { did: issuerDid },
    update: {},
    create: {
      did: issuerDid,
      publicKeyHex: '27d6b791faf45707d627b0601ebf99f0aa414beb2b3a1a1f342789751e8601bf',
      subjectType: 'agent'
    }
  });

  // 3. Seed the BookOrderingCredential
  const vcData = {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://w3id.org/security/suites/ed25519-2020/v1",
      "https://helixid.io/contexts/agent-permissions/v1"
    ],
    "id": "urn:uuid:dcc00200-3e09-49c1-ba7c-5877ca593b9c",
    "type": [
      "VerifiableCredential",
      "BookOrderingCredential"
    ],
    "issuer": issuerDid,
    "issuanceDate": "2026-02-27T17:41:35.873Z",
    "expirationDate": "2026-05-28T17:41:35.873Z",
    "credentialSubject": {
      "id": agentDid,
      "name": "Book Orderer Permission",
      "scopes": [
        "search_books",
        "place_order",
        "view_inventory",
        "check_order_status"
      ],
      "daily_limit": 50
    },
    "proof": {
      "type": "Ed25519Signature2020",
      "created": "2026-02-27T17:41:36Z",
      "verificationMethod": `${issuerDid}#did-root-key`,
      "proofPurpose": "assertionMethod",
      "proofValue": "zYqTAFNAkJZQvkpvs7oUezYLw2VwiJm1N3kafL4S7bnKeivfu5WYvJmTBhn8PJGuP3FyfHLKKp2izWjMqPcXMo6K"
    }
  };

  await prisma.verifiableCredential.upsert({
    where: { vcId: vcData.id },
    update: {},
    create: {
      vcId: vcData.id,
      subjectDid: agentDid,
      issuerDid: issuerDid,
      type: 'VerifiableCredential,BookOrderingCredential',
      vcJson: JSON.stringify(vcData),
      expiresAt: new Date(vcData.expirationDate),
      status: 'active'
    }
  });

  console.log('✅ Seeding complete! Database is ready for realistic verification.');
  await prisma.$disconnect();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
