# The single choke point where a verifiable presentation is created, Python
# port of ../../e2e-travel-concierge/agent/tools/protectedCall.ts. It loads
# the *selected persona's* wallet, picks either its default credential or the
# delegated credential selected by Use case 4, and signs a fresh VP bound to
# the MCP server. The private key is decrypted in-process and never
# transmitted.

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict

from agent.mcp_client import call_mcp_tool
from config import USER_DID, TARGET_SERVICE, env
from helix_sdk.vp_builder import VPBuilder
from helix_sdk.wallet import AgentWallet
from personas.types import Persona


@dataclass
class ProtectedResult:
    success: bool
    detail: str


def call_protected_tool(persona: Persona, tool_name: str, input: Dict[str, Any]) -> ProtectedResult:
    wallet = AgentWallet.load(persona.wallet_file, env.wallet_passphrase)
    credentials = wallet.credentials
    if not credentials:
        raise RuntimeError(f'Persona "{persona.id}" has no credential in its wallet')

    vc = None
    if persona.active_credential_id:
        vc = next((c for c in credentials if c.get("id") == persona.active_credential_id), None)
    else:
        vc = credentials[0]
    if vc is None:
        raise RuntimeError(
            f'Persona "{persona.id}" active credential {persona.active_credential_id} was not found in its wallet'
        )

    vp = VPBuilder(
        credentials=[vc], holder_did=wallet.get_did(), target_service=TARGET_SERVICE, user_did=USER_DID
    ).sign(wallet.get_private_key_hex(), f"{wallet.get_did()}#key-1")

    result = call_mcp_tool(tool_name, {**input, "_helixVP": vp})
    # Surface the real result (success or the real rejection reason) so the
    # model can report it truthfully -- the agent never writes the outcome
    # itself.
    return ProtectedResult(success=not result.is_error, detail=result.text)
