// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { useState } from 'react';

export interface RevokeButtonProps {
  /**
   * Performs the revocation (the page wires this to api.revokeAgent plus
   * its re-fetch + toast). The button never flips any status itself — the
   * badge only changes after the API confirms and the detail re-fetches
   * (dev spec §5.1).
   */
  onRevoke: () => Promise<void>;
  disabled?: boolean;
}

export function RevokeButton({ onRevoke, disabled = false }: RevokeButtonProps) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      await onRevoke();
    } catch {
      // Errors are surfaced by the page's toast, not here.
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="revoke-button"
      disabled={disabled || busy}
      onClick={() => void handleClick()}
    >
      {busy ? 'Revoking…' : 'Revoke'}
    </button>
  );
}
