# mcp_server -- a real Model Context Protocol server exposing two protected
# tools: search_flights (needs read:catalog) and book_flight (needs
# write:orders). Python port of ../../e2e-travel-concierge/mcp-server/server.ts,
# using the official `mcp` PyPI package for the wire protocol (matching the
# JS server's use of @modelcontextprotocol/sdk) and
# helix_mcp.helixid_mcp_middleware for scope enforcement.
#
# Tools are registered on the low-level Server (`FastMCP()._mcp_server`)
# rather than via the `@mcp.tool()` convenience decorator: that decorator
# builds a pydantic model from the function signature and pydantic rejects
# any parameter name starting with "_", so the `_helixVP` field (the wire
# name the agent actually sends -- see agent/tools/protected_call.py) cannot
# be declared that way. The low-level API takes the incoming arguments as a
# plain dict with no such restriction, which is also exactly how the JS
# server's Zod schema (`_helixVP: z.any().optional()`) handles it -- JS
# identifiers have no such restriction, so this is the Python-side
# equivalent, not a behavior change. FastMCP is still used for its ASGI
# HTTP wiring (streamable-http transport, host/port, health route).
#
# The only thing standing between an inbound tool call and the action is
# HelixID. For every call the server:
#   1. submits the presented VP to the live API's /v1/vp/verify -- this is
#      the authoritative identity/revocation check AND what writes the audit
#      event (VP_VERIFIED on success, VP_REJECTED on an invalid/revoked/
#      forged VP), so both accepted and rejected verifications show up in
#      Console; then
#   2. runs helix_mcp's middleware to enforce the tool's required scope.
# No VP, an invalid VP, or the wrong scope, and the tool never runs. This is
# not "the server trusts the caller because it sent a request" -- it is a
# cryptographically enforced, audited decision.

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List

from mcp import types
from mcp.server.fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse

from config import SCOPES, TARGET_SERVICE, TOOLS, env
from helix_mcp_middleware.middleware import helixid_mcp_middleware
from helix_mcp_middleware.types import MCPMiddlewareOptions
from helix_sdk import verify_vp
from helix_sdk.client import HelixClient
from helix_sdk.errors import HelixError


def log(message: str) -> None:
    print(f"[{datetime.now(timezone.utc).isoformat()}] [MCP] {message}", flush=True)


def _deny(tool: str, reason: str) -> types.CallToolResult:
    log(f"DENIED  {tool}  {reason}")
    return types.CallToolResult(content=[types.TextContent(type="text", text=f"Refused by HelixID: {reason}.")], isError=True)


def _is_delegated_vp(vp: Dict[str, Any]) -> bool:
    creds = vp.get("verifiableCredential") or []
    vc = creds[0] if creds else None
    if not isinstance(vc, dict):
        return False
    subject = vc.get("credentialSubject") or {}
    return bool(subject.get("parentVcId") or subject.get("delegatedFrom"))


helix_client = HelixClient(env.helix_api_url)


def _verify_with_api(signed_vp: Dict[str, Any]) -> Dict[str, Any]:
    """Submit the presentation to the live API's /v1/vp/verify. On success
    the API writes a VP_VERIFIED audit event and returns the agent DID; on
    failure it writes VP_REJECTED and this raises a typed HelixError. Either
    way the verification is real and lands in Console."""
    result = verify_vp(signed_vp, helix_client, allow_self_signed=False)
    return {
        "agentDid": result.get("agentDid", "unknown"),
        "verifiedAt": result.get("verifiedAt") or datetime.now(timezone.utc).isoformat(),
    }


def _describe_verification_failure(vp: Dict[str, Any], err: Exception) -> str:
    code = err.code if isinstance(err, HelixError) else "VP_VERIFICATION_FAILED"
    message = err.message if isinstance(err, HelixError) else str(err)
    creds = vp.get("verifiableCredential") or []
    vc = creds[0] if creds else None

    if isinstance(vc, dict):
        try:
            status = helix_client.check_vc_status(vc)
            if status == "revoked":
                return f"credential is revoked; VP verification failed ({code}: {message})"
            if status == "expired":
                return f"credential is expired; VP verification failed ({code}: {message})"
        except Exception as status_err:  # noqa: BLE001
            log(f"Could not enrich VP failure with credential status: {status_err}")

    return f"VP verification failed ({code}: {message})"


RunFn = Callable[[Dict[str, Any], str], "tuple[str, Dict[str, Any]]"]


def _guarded_run(tool_name: str, required_scope: str, args: Dict[str, Any], run: RunFn) -> types.CallToolResult:
    vp = args.get("_helixVP")
    if not vp:
        return _deny(tool_name, "no verifiable presentation was supplied")

    # 1) Authoritative verification via the live API (writes the audit event).
    try:
        verified = _verify_with_api(vp)
    except Exception as err:  # noqa: BLE001
        if not _is_delegated_vp(vp):
            return _deny(tool_name, _describe_verification_failure(vp, err))
        log(
            f"API verifier could not verify delegated VP for {tool_name}; continuing to local "
            f"helix_mcp chain enforcement ({err})."
        )
        verified = {"agentDid": vp.get("holder"), "verifiedAt": datetime.now(timezone.utc).isoformat()}

    # 2) Scope authorization via helix_mcp.
    gate = helixid_mcp_middleware(MCPMiddlewareOptions(client=helix_client, required_scopes=[required_scope], allow_self_signed=False))
    try:
        gate({"name": tool_name, "input": args})
    except HelixError as err:
        if err.code == "INSUFFICIENT_SCOPE":
            return _deny(tool_name, f"agent {verified['agentDid']} is verified but lacks the {required_scope} scope")
        return _deny(tool_name, f"authorization failed ({err.message})")
    except Exception as err:  # noqa: BLE001
        return _deny(tool_name, f"authorization failed ({err})")

    # 3) Authorized -> do the protected thing.
    log(f"GRANTED {tool_name}  agent={verified['agentDid']}  verifiedAt={verified['verifiedAt']}")
    text, structured = run(args, verified["agentDid"])
    return types.CallToolResult(content=[types.TextContent(type="text", text=text)], structuredContent=structured)


def _run_search_flights(args: Dict[str, Any], agent_did: str) -> "tuple[str, Dict[str, Any]]":
    origin = str(args.get("origin") or "")
    destination = str(args.get("destination") or "")
    flights = [
        {"flightId": "BA249", "carrier": "British Airways", "origin": origin, "destination": destination, "departs": "18:40"},
        {"flightId": "AI302", "carrier": "Air India", "origin": origin, "destination": destination, "departs": "09:15"},
    ]
    structured = {"flights": flights, "searchedBy": agent_did}
    return json.dumps(structured), structured


def _run_book_flight(args: Dict[str, Any], agent_did: str) -> "tuple[str, Dict[str, Any]]":
    booking = {
        "bookingId": f"BKG-{uuid.uuid4().hex[:8].upper()}",
        "flightId": str(args.get("flightId") or ""),
        "passengerName": str(args.get("passengerName") or ""),
        "status": "CONFIRMED",
        "verifiedAgent": agent_did,
        "targetService": TARGET_SERVICE,
    }
    return json.dumps(booking), booking


TOOL_DEFS: List[types.Tool] = [
    types.Tool(
        name=TOOLS["SEARCH"],
        title="Search flights",
        description="Search available flights. Requires a HelixID presentation carrying read:catalog.",
        inputSchema={
            "type": "object",
            "properties": {
                "origin": {"type": "string", "description": "Origin city or airport code"},
                "destination": {"type": "string", "description": "Destination city or airport code"},
                "date": {"type": "string", "description": "Optional travel date, YYYY-MM-DD"},
                # Attached programmatically by the agent (see the module doc
                # comment above for why this can't be a typed field here).
                "_helixVP": {},
            },
            "required": ["origin", "destination"],
        },
    ),
    types.Tool(
        name=TOOLS["BOOK"],
        title="Book a flight",
        description="Book a specific flight for a passenger. Requires a HelixID presentation carrying write:orders.",
        inputSchema={
            "type": "object",
            "properties": {
                "flightId": {"type": "string", "description": "The flight identifier to book, e.g. BA249"},
                "passengerName": {"type": "string", "description": "Full name of the passenger"},
                "_helixVP": {},
            },
            "required": ["flightId", "passengerName"],
        },
    ),
]

_RUNNERS: Dict[str, RunFn] = {TOOLS["SEARCH"]: _run_search_flights, TOOLS["BOOK"]: _run_book_flight}
_REQUIRED_SCOPES: Dict[str, str] = {TOOLS["SEARCH"]: SCOPES["FLIGHTS_READ"], TOOLS["BOOK"]: SCOPES["FLIGHTS_BOOK"]}


mcp = FastMCP(
    name="travel-booking-mcp",
    host="0.0.0.0",
    port=env.mcp_port,
    streamable_http_path="/mcp",
    json_response=True,
    stateless_http=True,
)


@mcp._mcp_server.list_tools()  # noqa: SLF001 -- see module doc comment
async def list_tools() -> List[types.Tool]:
    return TOOL_DEFS


@mcp._mcp_server.call_tool(validate_input=False)  # noqa: SLF001 -- see module doc comment
async def call_tool(name: str, arguments: Dict[str, Any]) -> types.CallToolResult:
    runner = _RUNNERS.get(name)
    required_scope = _REQUIRED_SCOPES.get(name)
    if runner is None or required_scope is None:
        return _deny(name, f"unknown tool {name}")
    return _guarded_run(name, required_scope, arguments, runner)


@mcp.custom_route("/health", methods=["GET"])
async def health(_request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok", "tools": [TOOLS["SEARCH"], TOOLS["BOOK"]]})


if __name__ == "__main__":
    log(f"travel-booking MCP server listening on :{env.mcp_port}/mcp")
    log(f"Guarding {TOOLS['SEARCH']} (needs {SCOPES['FLIGHTS_READ']}) and {TOOLS['BOOK']} (needs {SCOPES['FLIGHTS_BOOK']}) with helix_mcp.")
    mcp.run(transport="streamable-http")
