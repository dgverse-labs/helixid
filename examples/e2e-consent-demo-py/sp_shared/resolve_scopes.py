# Server-side scope resolution for the consent widget. Python port of
# @helixid/widget's src/server/resolve-scopes.ts -- that package has no
# Python equivalent (it's browser-widget tooling, not part of
# @helixid/sdk-js), so this is a direct reimplementation of its one
# exported function. See that file's own comments for the full rationale;
# kept here verbatim.

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

import requests

from helixid_config import CuratedScopeEntry

ACCEPT_TERMS_SCOPE = "accept-terms"


def humanize_scope(scope: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[:_-]+", " ", scope)).strip()


def _fetch_mcp_tool_scopes(mcp_server_url: str) -> List[Dict[str, Any]]:
    response = requests.post(
        mcp_server_url,
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        headers={"accept": "application/json"},
        timeout=5,
    )
    if not response.ok:
        raise RuntimeError(f"MCP tools/list responded {response.status_code}")
    tools = (response.json().get("result") or {}).get("tools")
    return tools if isinstance(tools, list) else []


def resolve_consent_scopes(
    curated_fallback: List[CuratedScopeEntry], mcp_server_url: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Output is the full union of curated fallback (union) MCP tool scopes
    (union) accept-terms -- always the SP's whole catalog, never filtered
    against what any particular agent requested. See the TS source for why."""
    resolved: Dict[str, Dict[str, Any]] = {}
    for entry in curated_fallback:
        option: Dict[str, Any] = {"scope": entry.scope, "label": entry.label}
        if entry.description is not None:
            option["description"] = entry.description
        if entry.required is not None:
            option["required"] = entry.required
        resolved[entry.scope] = option

    if mcp_server_url:
        try:
            tools = _fetch_mcp_tool_scopes(mcp_server_url)
        except Exception:
            # MCP is the enrichment source, curated is the fallback -- an
            # unreachable MCP server yields a curated-only catalog rather
            # than failing the consent page.
            tools = []

        for tool in tools:
            metadata = tool.get("metadata") or {}
            scope = metadata.get("requiredScope")
            if not scope:
                continue
            existing = resolved.get(scope, {})
            label = metadata.get("label", existing.get("label"))
            description = metadata.get("description", tool.get("description", existing.get("description")))
            required = existing.get("required")
            option = {"scope": scope, "label": label or ""}
            if description is not None:
                option["description"] = description
            if required is not None:
                option["required"] = required
            resolved[scope] = option

    scope_options = [
        {**option, "label": option["label"] if option.get("label") else humanize_scope(option["scope"])}
        for option in resolved.values()
    ]

    scope_options.append(
        {
            "scope": ACCEPT_TERMS_SCOPE,
            "label": "Accept the terms and conditions",
            "required": True,
            "defaultChecked": True,
        }
    )
    return scope_options
