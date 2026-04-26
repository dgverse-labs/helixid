# Helix ID — Agent Playbook

This playbook provides guidance for Agent developers interacting with the Helix ID infrastructure.

## 1. Verifiable Presentation (VP) Flow

To prove your identity and authorization to a target service, follow these steps:

### Step 1: Request a VP Template
Call the `/v1/vp/template` endpoint with your identifiers and the **explicit type of credential** you want to present.

**Endpoint**: `POST /v1/vp/template`

**Request Body**:
```json
{
  "agentDid": "did:hedera:testnet:<your-agent-did>",
  "userDid": "did:hedera:testnet:<the-user-did>",
  "targetService": "amazon",
  "vcType": "HelixAgentCredential"
}
```

*   **`vcType`**: This is a mandatory property. It tells Helix ID which specific credential from your wallet should be included in the presentation.
*   **Ambiguity Handling**: If you have multiple valid credentials of the same `vcType`, the server will return a `400 VPMultipleActiveVCError`. In this case, you should check your wallet and ensure only one valid credential of that type is active (or wait for the older ones to expire).

### Step 2: Sign the Template
The server returns an `unsignedVP`. You must sign this locally using your private key.

1.  Extract the `unsignedVP` from the response.
2.  Canonicalize the JSON.
3.  Sign the hash of the canonical JSON with your Ed25519 private key.
4.  Attach the signature in a `proof` block.

### Step 3: Verify the VP
Submit the signed VP back to the server.

**Endpoint**: `POST /v1/vp/verify`

**Request Body**:
```json
{
  "signedVP": { ... }
}
```

## 2. Common Error Codes

| Code | Meaning | Action |
| :--- | :--- | :--- |
| `VP_NO_ACTIVE_VC` | No valid VC of the requested type was found. | Ensure you have completed onboarding and your VC hasn't expired. |
| `VP_MULTIPLE_ACTIVE_VC` | More than one valid VC of the requested type was found. | Helix ID requires an unambiguous credential selection. Ensure only one VC of this type is active. |
| `SERVICE_NOT_FOUND` | The `targetService` is not registered. | Check the service registry via `GET /v1/services`. |
