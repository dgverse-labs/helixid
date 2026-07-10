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
}

/** The safe projection sent to the browser: no wallet material, ever. */
export interface PersonaPublic {
  id: string;
  displayName: string;
  scopes: string[];
}

export function toPublic(p: Persona): PersonaPublic {
  return { id: p.id, displayName: p.displayName, scopes: p.scopes };
}
