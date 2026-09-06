# One Service Provider app. Python port of sp-shared/app.ts. Both demo SPs
# are this same shape -- only the tool catalog and scope strings differ.
#
# This single app owns all four SP responsibilities:
#   C1  POST /api/mcp              MCP endpoint (tools/list + tools/call)
#   C2  GET  /api/consent/scopes   scope resolution for the widget
#   C3  POST /api/consent/accept   grant issuance -- signs with the SP's key
#   C4  the booking handlers behind C1's scope gate
#
# plus the two artifacts an SP must host for anyone to verify its grants:
#   GET /.well-known/did.json      its did:web document
#   GET /status-list/1             its Bitstring status list
#
# The SP's private key lives only in this process. The browser never sees
# it; grant signing happens exclusively inside POST /api/consent/accept.

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from flask import Flask, Response, jsonify, request, send_from_directory

from helix_sdk.client import HelixClient
from helix_sdk.did import build_did_document
from helix_sdk.errors import HelixError
from helix_sdk.grant import IssuerKeyMaterial, issue_grant

from helixid_config import SpDefinition, status_list_url_for
from sp_shared.audit import AuditEmitter, AuditEvents, NOOP
from sp_shared.html import consent_page_html, sp_login_page_html
from sp_shared.resolve_scopes import resolve_consent_scopes
from sp_shared.store import SpStore


def create_sp_app(
    definition: SpDefinition,
    issuer_did: str,
    issuer_private_key_hex: str,
    issuer_public_key_hex: str,
    base_url: str,
    helix_api_url: str,
    store: SpStore,
    mcp_server_url: Optional[str] = None,
    widget_dist_path: Optional[str] = None,
    audit: Optional[AuditEmitter] = None,
) -> tuple:
    status_list_url = status_list_url_for(base_url)
    resolved_mcp_url = mcp_server_url or f"{base_url}/api/mcp"
    helix_client = HelixClient(helix_api_url)
    audit_emitter = audit or NOOP

    counters = {"grantsIssued": 0, "scopeResolutions": 0, "consentRequired": 0}

    app = Flask(definition.id)
    browser_sessions: set = set()

    def log(message: str) -> None:
        print(f"[{datetime.now(timezone.utc).isoformat()}] [{definition.id}] {message}", flush=True)

    def current_browser_session() -> Optional[str]:
        token = request.cookies.get("sp_session")
        return token if token in browser_sessions else None

    # -- Hosted identity artifacts -------------------------------------------

    @app.get("/.well-known/did.json")
    def did_doc() -> Any:
        return jsonify(build_did_document(issuer_did, issuer_public_key_hex))

    @app.get("/status-list/<list_id>")
    def status_list(list_id: str) -> Any:
        return jsonify(store.get_status_list())

    @app.get("/health")
    def health() -> Any:
        return jsonify(
            {
                "status": "ok",
                "sp": definition.id,
                "did": issuer_did,
                "statusListUrl": status_list_url,
                "tools": [t.name for t in definition.tools],
            }
        )

    # -- C2: scope resolution for the consent widget -------------------------

    @app.get("/api/consent/scopes")
    def consent_scopes() -> Any:
        agent_did = request.args.get("agentDid", "")
        log(f"consent scopes requested (agentDid={agent_did or 'none'})")
        counters["scopeResolutions"] += 1
        try:
            scope_options = resolve_consent_scopes(definition.curated_fallback, resolved_mcp_url)
            return jsonify({"scopeOptions": scope_options})
        except Exception as exc:  # noqa: BLE001
            return jsonify({"error": {"code": "SCOPE_RESOLUTION_FAILED", "message": str(exc)}}), 500

    # -- C3: grant issuance ---------------------------------------------------

    @app.post("/api/consent/accept")
    def consent_accept() -> Any:
        body = request.get_json(silent=True) or {}
        agent_did = body.get("agentDid")
        user_did = body.get("userDid")
        scopes = body.get("scopes")
        durability = body.get("durability")
        correlation_id = body.get("correlationId")

        if not agent_did or not user_did or not isinstance(scopes, list) or not durability:
            return (
                jsonify(
                    {
                        "error": {
                            "code": "INVALID_REQUEST",
                            "message": "agentDid, userDid, scopes and durability are required",
                        }
                    }
                ),
                400,
            )

        try:
            scope_options = resolve_consent_scopes(definition.curated_fallback, resolved_mcp_url)
            missing_required = [
                o["scope"] for o in scope_options if o.get("required") and o["scope"] not in scopes
            ]
            if missing_required:
                return (
                    jsonify(
                        {
                            "error": {
                                "code": "MISSING_REQUIRED_SCOPE",
                                "message": f"Selection is missing required scope(s): {', '.join(missing_required)}",
                                "missingRequired": missing_required,
                            }
                        }
                    ),
                    400,
                )
        except Exception as exc:  # noqa: BLE001
            return jsonify({"error": {"code": "SCOPE_RESOLUTION_FAILED", "message": str(exc)}}), 500

        try:
            result = issue_grant(
                helix_client,
                IssuerKeyMaterial(did=issuer_did, private_key_hex=issuer_private_key_hex),
                agent_did,
                user_did,
                scopes,
                durability,
                store.get_status_list(),
                status_list_url,
                service_did=issuer_did,
            )
            grant_vc = result["grantVC"]
            updated_status_list = result["updatedStatusList"]

            store.record_grant(
                {
                    "grantVC": grant_vc,
                    "agentDid": agent_did,
                    "userDid": user_did,
                    "scopes": scopes,
                    "durability": durability,
                    "issuedAt": datetime.now(timezone.utc).isoformat(),
                },
                updated_status_list,
            )

            counters["grantsIssued"] += 1
            log(f"grant issued to {agent_did} for {user_did} [{', '.join(scopes)}]")
            audit_emitter.emit(
                {
                    "event": AuditEvents.VC_ISSUED,
                    "correlationId": correlation_id,
                    "agentDid": agent_did,
                    "userDid": user_did,
                    "vcId": grant_vc.get("id"),
                    "credentialType": "DelegationGrantCredential",
                    "issuer": issuer_did,
                    "scopes": scopes,
                    "validUntil": grant_vc.get("validUntil"),
                    "credentialStatus": "active",
                    "result": "success",
                    "resultSummary": f"Consent grant issued for {', '.join(scopes)}",
                }
            )
            return jsonify({"grantVC": grant_vc}), 201
        except Exception as exc:  # noqa: BLE001
            return jsonify({"error": {"code": "GRANT_ISSUANCE_FAILED", "message": str(exc)}}), 500

    # -- C1 + C4: MCP endpoint and the booking handlers behind it ------------

    @app.post("/api/mcp")
    def mcp() -> Any:
        rpc = request.get_json(silent=True) or {}
        rpc_id = rpc.get("id")
        method = rpc.get("method")

        if method == "tools/list":
            return jsonify(
                _jsonrpc_result(
                    rpc_id,
                    {"tools": [t.to_dict() for t in definition.tools]},
                )
            )

        if method != "tools/call":
            return jsonify(_jsonrpc_error(rpc_id, -32601, f"Method not found: {method}"))

        params = rpc.get("params") or {}
        tool_name = params.get("name", "")
        args = dict(params.get("arguments") or {})
        tool = next((t for t in definition.tools if t.name == tool_name), None)
        if not tool:
            return jsonify(_jsonrpc_error(rpc_id, -32602, f"Unknown tool: {tool_name}"))

        required_scope = tool.required_scope
        correlation_id = args.get("_helixCorrelationId") if isinstance(args.get("_helixCorrelationId"), str) else None

        # Open, read-only tools run with no presentation and no scope check.
        if not required_scope:
            log(f"OPEN    {tool_name}")
            output = _run_tool(tool_name, args, "anonymous")
            audit_emitter.emit(
                {
                    "event": AuditEvents.TOOL_INVOKED,
                    "correlationId": correlation_id,
                    "toolName": tool_name,
                    "result": "success",
                    "resultSummary": _summarize_tool_result(tool_name, output),
                    "reason": "OPEN_TOOL_NO_SCOPE_REQUIRED",
                }
            )
            return jsonify(_jsonrpc_result(rpc_id, {"structuredContent": output}))

        vp = args.get("_helixVP")
        if not vp:
            counters["consentRequired"] += 1
            log(f"DENIED  {tool_name}  no presentation supplied")
            audit_emitter.emit(
                {
                    "event": AuditEvents.AUTHZ_DENIED,
                    "correlationId": correlation_id,
                    "toolName": tool_name,
                    "requiredScope": required_scope,
                    "result": "blocked",
                    "reason": "NO_PRESENTATION",
                    "resultSummary": f"{tool_name} needs consent — no credential presented",
                }
            )
            return jsonify(
                _jsonrpc_error(
                    rpc_id,
                    -32001,
                    "Consent required",
                    {
                        "code": "CONSENT_REQUIRED",
                        "reason": "NO_PRESENTATION",
                        "requiredScope": required_scope,
                        "serviceDid": issuer_did,
                        "consentUrl": f"{base_url}/consent",
                    },
                )
            )

        presented_credentials = vp.get("verifiableCredential") if isinstance(vp.get("verifiableCredential"), list) else []
        audit_emitter.emit(
            {
                "event": AuditEvents.VC_PRESENTED,
                "correlationId": correlation_id,
                "agentDid": vp.get("holder") if isinstance(vp.get("holder"), str) else None,
                "userDid": vp.get("delegatedBy") if isinstance(vp.get("delegatedBy"), str) else None,
                "vpId": vp.get("id") if isinstance(vp.get("id"), str) else None,
                "credentialType": " + ".join(
                    t
                    for entry in presented_credentials
                    for t in (entry.get("type") or [])
                    if t != "VerifiableCredential"
                ),
                "toolName": tool_name,
                "requiredScope": required_scope,
                "result": "success",
                "resultSummary": f"Presented {len(presented_credentials)} credential(s) to {definition.display_name}",
            }
        )

        try:
            result = helix_client.verify_vp(vp, expected_target_service=issuer_did)
            effective_scopes = result.get("effectiveScopes", [])
            agent_did = result.get("agentDid")
        except HelixError as exc:
            code = exc.code or "VP_VERIFICATION_FAILED"
            return _deny_verification(rpc_id, tool_name, required_scope, correlation_id, vp, code, log, audit_emitter)
        except Exception:  # noqa: BLE001
            return _deny_verification(
                rpc_id, tool_name, required_scope, correlation_id, vp, "VP_VERIFICATION_FAILED", log, audit_emitter
            )

        audit_emitter.emit(
            {
                "event": AuditEvents.VP_VERIFIED,
                "correlationId": correlation_id,
                "agentDid": agent_did,
                "userDid": vp.get("delegatedBy") if isinstance(vp.get("delegatedBy"), str) else None,
                "vpId": vp.get("id") if isinstance(vp.get("id"), str) else None,
                "toolName": tool_name,
                "requiredScope": required_scope,
                "effectiveScopes": effective_scopes,
                "result": "success",
                "resultSummary": "Signatures, validity and revocation all checked out",
            }
        )

        grant_from_this_sp = next(
            (
                entry
                for entry in presented_credentials
                if isinstance(entry.get("type"), list)
                and "DelegationGrantCredential" in entry["type"]
                and entry.get("issuer") == issuer_did
            ),
            None,
        )
        if not grant_from_this_sp:
            counters["consentRequired"] += 1
            log(f"DENIED  {tool_name}  agent {agent_did} verified but presented no grant from this SP")
            audit_emitter.emit(
                {
                    "event": AuditEvents.AUTHZ_DENIED,
                    "correlationId": correlation_id,
                    "agentDid": agent_did,
                    "userDid": vp.get("delegatedBy") if isinstance(vp.get("delegatedBy"), str) else None,
                    "toolName": tool_name,
                    "requiredScope": required_scope,
                    "effectiveScopes": effective_scopes,
                    "result": "blocked",
                    "reason": "NO_GRANT_FOR_THIS_SERVICE",
                    "resultSummary": (
                        f"{tool_name} needs consent — credential verified, but this user has not yet "
                        f"authorized {definition.display_name}"
                    ),
                }
            )
            return jsonify(
                _jsonrpc_error(
                    rpc_id,
                    -32001,
                    "Consent required",
                    {
                        "code": "CONSENT_REQUIRED",
                        "reason": "NO_GRANT_FOR_THIS_SERVICE",
                        "requiredScope": required_scope,
                        "serviceDid": issuer_did,
                        "consentUrl": f"{base_url}/consent",
                    },
                )
            )

        if required_scope not in effective_scopes:
            counters["consentRequired"] += 1
            log(f"DENIED  {tool_name}  agent {agent_did} verified but lacks {required_scope}")
            audit_emitter.emit(
                {
                    "event": AuditEvents.AUTHZ_DENIED,
                    "correlationId": correlation_id,
                    "agentDid": agent_did,
                    "userDid": vp.get("delegatedBy") if isinstance(vp.get("delegatedBy"), str) else None,
                    "vcId": grant_from_this_sp.get("id"),
                    "toolName": tool_name,
                    "requiredScope": required_scope,
                    "effectiveScopes": effective_scopes,
                    "result": "blocked",
                    "reason": "INSUFFICIENT_EFFECTIVE_SCOPE",
                    "resultSummary": (
                        f'{tool_name} blocked — required scope "{required_scope}" not present in '
                        f"[{', '.join(effective_scopes)}]"
                    ),
                }
            )
            return jsonify(
                _jsonrpc_error(
                    rpc_id,
                    -32001,
                    "Consent required",
                    {
                        "code": "CONSENT_REQUIRED",
                        "reason": "INSUFFICIENT_EFFECTIVE_SCOPE",
                        "requiredScope": required_scope,
                        "serviceDid": issuer_did,
                        "consentUrl": f"{base_url}/consent",
                    },
                )
            )

        log(f"GRANTED {tool_name}  agent={agent_did}  effectiveScopes=[{', '.join(effective_scopes)}]")
        audit_emitter.emit(
            {
                "event": AuditEvents.AUTHZ_GRANTED,
                "correlationId": correlation_id,
                "agentDid": agent_did,
                "userDid": vp.get("delegatedBy") if isinstance(vp.get("delegatedBy"), str) else None,
                "vcId": grant_from_this_sp.get("id"),
                "credentialType": "DelegationGrantCredential",
                "issuer": issuer_did,
                "toolName": tool_name,
                "requiredScope": required_scope,
                "effectiveScopes": effective_scopes,
                "result": "success",
                "resultSummary": f'Authorized for "{required_scope}"',
            }
        )

        output = _run_tool(tool_name, args, agent_did)
        audit_emitter.emit(
            {
                "event": AuditEvents.TOOL_INVOKED,
                "correlationId": correlation_id,
                "agentDid": agent_did,
                "userDid": vp.get("delegatedBy") if isinstance(vp.get("delegatedBy"), str) else None,
                "vcId": grant_from_this_sp.get("id"),
                "toolName": tool_name,
                "requiredScope": required_scope,
                "effectiveScopes": effective_scopes,
                "result": "success",
                "resultSummary": _summarize_tool_result(tool_name, output),
            }
        )
        return jsonify(_jsonrpc_result(rpc_id, {"structuredContent": output}))

    def _deny_verification(rpc_id, tool_name, required_scope, correlation_id, vp, code, log_fn, audit_emitter_):
        log_fn(f"DENIED  {tool_name}  verification failed ({code})")
        audit_emitter_.emit(
            {
                "event": AuditEvents.VP_REJECTED,
                "correlationId": correlation_id,
                "agentDid": vp.get("holder") if isinstance(vp.get("holder"), str) else None,
                "vpId": vp.get("id") if isinstance(vp.get("id"), str) else None,
                "toolName": tool_name,
                "requiredScope": required_scope,
                "result": "failure",
                "reason": code,
                "resultSummary": f"Verification failed ({code})",
            }
        )
        return jsonify(
            _jsonrpc_error(
                rpc_id,
                -32002,
                "Presentation could not be verified",
                {"code": "VP_INVALID", "reason": code},
            )
        )

    # -- Consent page ----------------------------------------------------------

    if widget_dist_path:

        @app.get("/widget/<path:filename>")
        def widget_static(filename: str) -> Any:
            return send_from_directory(widget_dist_path, filename)

    @app.get("/consent")
    def consent_page() -> Any:
        agent_did = request.args.get("agentDid", "")
        user_did = request.args.get("userDid", "")
        demo = request.args.get("demo") == "1"
        correlation_id = request.args.get("correlationId", "")
        if not current_browser_session():
            return Response(sp_login_page_html(definition, agent_did, user_did, demo), mimetype="text/html")
        return Response(
            consent_page_html(definition, agent_did, user_did, issuer_did, demo, correlation_id),
            mimetype="text/html",
        )

    @app.post("/api/sp-login")
    def sp_login() -> Any:
        body = request.get_json(silent=True) or {}
        if body.get("username") != "ada" or body.get("password") != "demo123":
            return jsonify({"error": "Invalid username or password"}), 401
        token = str(uuid.uuid4())
        browser_sessions.add(token)
        agent_did = body.get("agentDid", "")
        user_did = body.get("userDid", "")
        resp = jsonify(
            {
                "authenticated": True,
                "redirectUrl": f"/consent?agentDid={_qs(agent_did)}&userDid={_qs(user_did)}",
            }
        )
        resp.set_cookie("sp_session", token, httponly=True, samesite="Lax", path="/")
        return resp

    return app, counters


def _qs(value: str) -> str:
    from urllib.parse import quote

    return quote(value, safe="")


def _jsonrpc_result(rpc_id: Any, result: Any) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rpc_id if rpc_id is not None else None, "result": result}


def _jsonrpc_error(rpc_id: Any, code: int, message: str, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    error: Dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": rpc_id if rpc_id is not None else None, "error": error}


# -- C4: the booking backend --------------------------------------------------


def _summarize_tool_result(tool_name: str, output: Dict[str, Any]) -> str:
    flights = output.get("flights")
    if isinstance(flights, list):
        return f"{len(flights)} flight{'' if len(flights) == 1 else 's'} found"
    hotels = output.get("hotels")
    if isinstance(hotels, list):
        return f"{len(hotels)} hotel{'' if len(hotels) == 1 else 's'} found"
    booking_id = output.get("bookingId")
    if isinstance(booking_id, str) and booking_id:
        status = output.get("status") if isinstance(output.get("status"), str) else "OK"
        return f"{status} — {booking_id}"
    return f"{tool_name} completed"


def _run_tool(tool_name: str, args: Dict[str, Any], agent_did: str) -> Dict[str, Any]:
    if tool_name == "search_flights":
        origin = str(args.get("origin", "")).upper()
        destination = str(args.get("destination", "")).upper()
        departure_date = str(args.get("departureDate", ""))
        travelers = max(1, _to_int(args.get("travelers"), 1))
        carrier_pref = str(args.get("carrier", "")).strip().lower()

        route = f"{origin}-{destination}"
        inventory = FLIGHT_INVENTORY.get(route, [])
        date_available = departure_date == "" or _is_searchable_date(departure_date)

        flights = inventory if date_available else []
        if carrier_pref and carrier_pref != "any":
            narrowed = [f for f in flights if carrier_pref in f["carrier"].lower()]
            if narrowed:
                flights = narrowed

        return {
            "query": {
                "origin": origin,
                "destination": destination,
                "departureDate": departure_date,
                "travelers": travelers,
                "carrier": carrier_pref or "any",
            },
            "flights": [
                {
                    **f,
                    "origin": origin,
                    "destination": destination,
                    "departureDate": departure_date,
                    "travelers": travelers,
                    "totalFare": f["fare"] * travelers,
                }
                for f in flights
            ],
        }
    if tool_name == "book_flight":
        return {
            "bookingId": f"FLT-{uuid.uuid4().hex[:8].upper()}",
            "flightId": str(args.get("flightId", "")),
            "status": "CONFIRMED",
            "bookedBy": agent_did,
        }
    if tool_name == "modify_booking":
        return {
            "bookingId": str(args.get("bookingId", "")),
            "status": "MODIFIED",
            "modifiedBy": agent_did,
        }
    if tool_name == "search_hotels":
        city = str(args.get("city", "DEL")).upper()
        max_nightly_rate = _to_int(args.get("maxNightlyRate"), 0)
        guests = max(1, _to_int(args.get("guests"), 1))

        hotels = HOTEL_INVENTORY.get(city, [])
        if max_nightly_rate > 0:
            affordable = [h for h in hotels if h["nightlyRate"] <= max_nightly_rate]
            hotels = affordable if affordable else sorted(hotels, key=lambda h: h["nightlyRate"])[:1]

        return {
            "query": {"city": city, "maxNightlyRate": max_nightly_rate or None, "guests": guests},
            "hotels": [{**h, "city": city, "guests": guests} for h in hotels],
        }
    if tool_name == "book_hotel":
        return {
            "bookingId": f"HTL-{uuid.uuid4().hex[:8].upper()}",
            "hotelId": str(args.get("hotelId", "")),
            "status": "CONFIRMED",
            "bookedBy": agent_did,
        }
    return {"ok": True}


def _to_int(value: Any, default: int) -> int:
    try:
        return int(value) if value not in (None, "") else default
    except (TypeError, ValueError):
        return default


FLIGHT_INVENTORY: Dict[str, List[Dict[str, Any]]] = {
    "TVM-DEL": [
        {"flightId": "HA401", "carrier": "Helix Air", "departs": "08:20", "arrives": "11:05", "durationMinutes": 165, "stops": 0, "fare": 8450, "cabin": "Economy"},
        {"flightId": "HA733", "carrier": "Helix Air", "departs": "19:05", "arrives": "21:50", "durationMinutes": 165, "stops": 0, "fare": 6980, "cabin": "Economy"},
        {"flightId": "SK512", "carrier": "Skyline", "departs": "13:40", "arrives": "17:20", "durationMinutes": 220, "stops": 1, "fare": 5600, "cabin": "Economy"},
    ],
    "TVM-BOM": [
        {"flightId": "HA215", "carrier": "Helix Air", "departs": "07:10", "arrives": "09:15", "durationMinutes": 125, "stops": 0, "fare": 6300, "cabin": "Economy"},
        {"flightId": "SK629", "carrier": "Skyline", "departs": "16:45", "arrives": "19:10", "durationMinutes": 145, "stops": 0, "fare": 4850, "cabin": "Economy"},
    ],
    "DEL-TVM": [
        {"flightId": "HA402", "carrier": "Helix Air", "departs": "14:30", "arrives": "17:20", "durationMinutes": 170, "stops": 0, "fare": 8100, "cabin": "Economy"},
        {"flightId": "SK513", "carrier": "Skyline", "departs": "06:15", "arrives": "10:05", "durationMinutes": 230, "stops": 1, "fare": 5400, "cabin": "Economy"},
    ],
    "BOM-TVM": [
        {"flightId": "HA216", "carrier": "Helix Air", "departs": "18:15", "arrives": "20:20", "durationMinutes": 125, "stops": 0, "fare": 6150, "cabin": "Economy"},
    ],
}

HOTEL_INVENTORY: Dict[str, List[Dict[str, Any]]] = {
    "DEL": [
        {"hotelId": "HS-DEL-1", "name": "Helix Stay Aerocity", "nightlyRate": 7400, "rating": 4.5, "area": "Aerocity", "amenities": ["Airport shuttle", "Pool", "Breakfast"]},
        {"hotelId": "HS-DEL-2", "name": "Helix Stay Connaught", "nightlyRate": 9100, "rating": 4.7, "area": "Connaught Place", "amenities": ["City centre", "Spa", "Breakfast"]},
        {"hotelId": "HS-DEL-3", "name": "Helix Stay Saket", "nightlyRate": 4900, "rating": 4.1, "area": "Saket", "amenities": ["Metro nearby", "Workspace"]},
    ],
    "BOM": [
        {"hotelId": "HS-BOM-1", "name": "Helix Stay Bandra", "nightlyRate": 8200, "rating": 4.6, "area": "Bandra West", "amenities": ["Sea view", "Gym"]},
        {"hotelId": "HS-BOM-2", "name": "Helix Stay Andheri", "nightlyRate": 5300, "rating": 4.2, "area": "Andheri East", "amenities": ["Airport shuttle", "Workspace"]},
    ],
}


def _is_searchable_date(value: str) -> bool:
    import re

    if not re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        return False
    try:
        requested = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    from datetime import timedelta

    return today <= requested <= today + timedelta(days=365)
