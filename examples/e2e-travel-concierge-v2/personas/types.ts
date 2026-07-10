// A "persona" is a selectable enrolled-agent context: its own wallet, its own
// credential, its own scopes. Switching personas in the UI switches which wallet
// signs the next protected tool call.

export interface Persona {
  id: string;
  displayName: string;
  /** Scopes the credential carries (informational — enforcement is server-side). */
  scopes: string[];
  /** Absolute path to the encrypted wallet. Server-side only — never sent to a browser. */
  walletFile: string;
  /** Preferred VC for signing, used by the delegation demo after a child VC is added. */
  activeCredentialId?: string;
  /** Safe delegation metadata for the UI; no credential material. */
  delegatedFromPersonaId?: string;
  delegatedScopes?: string[];
}

/** The safe projection sent to the browser: no wallet material, ever. */
export interface PersonaPublic {
  id: string;
  displayName: string;
  scopes: string[];
  delegatedFromPersonaId?: string;
  delegatedScopes?: string[];
}

export function toPublic(p: Persona): PersonaPublic {
  return {
    id: p.id,
    displayName: p.displayName,
    scopes: p.scopes,
    delegatedFromPersonaId: p.delegatedFromPersonaId,
    delegatedScopes: p.delegatedScopes,
  };
}
