INSERT INTO "service_registry" (
  "id",
  "serviceName",
  "displayName",
  "verifiedDomain",
  "publicKeyMultibase",
  "apiEndpoint",
  "metadata",
  "active",
  "createdAt",
  "updatedAt"
) VALUES
  (
    'builtin-amazon',
    'amazon',
    'Amazon Retail',
    'https://amazon.com',
    'z6MkgYvYFsCcNycDE9iJ6shfX88oZ3LGH5x9R673d39R',
    'https://api.amazon.com/helix-verify',
    '{}',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'builtin-helix-delegation',
    'helix-delegation',
    'Helix Delegation',
    'https://helixid.io',
    'z6MkgYvYFsCcNycDE9iJ6shfX88oZ3LGH5x9R673d39R',
    'https://api.helixid.io/helix-delegation',
    '{}',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("serviceName") DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "verifiedDomain" = EXCLUDED."verifiedDomain",
  "publicKeyMultibase" = EXCLUDED."publicKeyMultibase",
  "apiEndpoint" = EXCLUDED."apiEndpoint",
  "metadata" = EXCLUDED."metadata",
  "active" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
