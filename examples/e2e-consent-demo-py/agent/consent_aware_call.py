# The agent's consent-aware tool call -- the whole of Part D's behaviour in
# one function. Python port of agent/consentAwareCall.ts.
#
# The agent itself has no consent logic: it never decides what the user may
# authorize, it only notices when an SP says "not without a grant" and hands
# off to that SP's own consent page. What makes step 5 of the demo work is
# the first line of call_sp_tool(): before building any presentation, ask the
# wallet whether a grant for THIS (service, user) pair already exists.

from __future__ import annotations

import json
from typing import Any, Callable, Dict, Optional

import requests

from helix_sdk.vp_builder import VPBuilder
from helix_sdk.wallet import AgentWallet


class ConsentDeclinedError(Exception):
    def __init__(self, service_did: str) -> None:
        super().__init__(f"User declined consent for {service_did}")
        self.name = "ConsentDeclinedError"


def _find_existing_grant(wallet: AgentWallet, service_did: str, user_did: str) -> Optional[Dict[str, Any]]:
    stored = wallet.select_grant(service_did, user_did)
    return json.loads(stored.vc_json) if stored else None


def _build_vp(wallet: AgentWallet, service_did: str, user_did: str, grant: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    agent_vc = next((vc for vc in wallet.credentials if "HelixAgentCredential" in (vc.get("type") or [])), None)
    if not agent_vc:
        raise RuntimeError("Agent wallet holds no HelixAgentCredential. Run enrollment first.")

    credentials = [agent_vc, grant] if grant else [agent_vc]
    builder = VPBuilder(
        credentials=credentials, holder_did=wallet.get_did(), target_service=service_did, user_did=user_did
    )
    return builder.sign(wallet.get_private_key_hex(), f"{wallet.get_did()}#key-1")


def _post_tool_call(
    sp_mcp_url: str, tool_name: str, args: Dict[str, Any], vp: Dict[str, Any], correlation_id: Optional[str] = None
) -> Dict[str, Any]:
    arguments = {**args, "_helixVP": vp}
    if correlation_id is not None:
        arguments["_helixCorrelationId"] = correlation_id
    response = requests.post(
        sp_mcp_url,
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool_name, "arguments": arguments}},
        timeout=15,
    )
    return response.json()


# Called with {serviceDid, consentUrl, requiredScope}; returns the grant VC
# or None if the user declined. In the browser demo this always returns
# None -- the server never blocks; the browser drives the SP consent popup
# and retries POST /api/call itself.
ConsentHandler = Callable[[Dict[str, str]], Optional[Dict[str, Any]]]


def call_sp_tool(
    wallet: AgentWallet,
    user_did: str,
    sp_mcp_url: str,
    service_did: str,
    tool_name: str,
    on_consent_required: ConsentHandler,
    args: Optional[Dict[str, Any]] = None,
    correlation_id: Optional[str] = None,
) -> Dict[str, Any]:
    args = args or {}

    # Step 5 hinges on this: reuse a standing grant if the wallet already has one.
    existing_grant = _find_existing_grant(wallet, service_did, user_did)
    first = _post_tool_call(
        sp_mcp_url, tool_name, args, _build_vp(wallet, service_did, user_did, existing_grant), correlation_id
    )

    if not first.get("error"):
        result = {"ok": True, "consentPrompted": False}
        content = (first.get("result") or {}).get("structuredContent")
        if content is not None:
            result["data"] = content
        return result

    error = first["error"]
    error_data = error.get("data") or {}
    if error_data.get("code") != "CONSENT_REQUIRED":
        return {
            "ok": False,
            "consentPrompted": False,
            "error": {
                "code": error_data.get("code", "CALL_FAILED"),
                "reason": error_data.get("reason"),
                "message": error.get("message", "Tool call failed"),
            },
        }

    # The SP wants a grant. Hand off to its consent page.
    grant_vc = on_consent_required(
        {
            "serviceDid": service_did,
            "consentUrl": error_data.get("consentUrl", ""),
            "requiredScope": error_data.get("requiredScope", ""),
        }
    )
    if not grant_vc:
        raise ConsentDeclinedError(service_did)

    wallet.add_credential(grant_vc)

    retry = _post_tool_call(
        sp_mcp_url, tool_name, args, _build_vp(wallet, service_did, user_did, grant_vc), correlation_id
    )

    if retry.get("error"):
        retry_error = retry["error"]
        retry_data = retry_error.get("data") or {}
        return {
            "ok": False,
            "consentPrompted": True,
            "error": {
                "code": retry_data.get("code", "CALL_FAILED"),
                "reason": retry_data.get("reason"),
                "message": retry_error.get("message", "Tool call failed after consent"),
            },
        }

    result = {"ok": True, "consentPrompted": True}
    content = (retry.get("result") or {}).get("structuredContent")
    if content is not None:
        result["data"] = content
    return result
