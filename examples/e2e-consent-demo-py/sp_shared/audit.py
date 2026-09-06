# Service-Provider-side audit emission. Python port of sp-shared/audit.ts.
#
# Every emission is best-effort and fire-and-forget (a background thread, not
# awaited) -- an SP must keep serving tool calls when the audit sink is
# unreachable.

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import requests

# The demo's audit event type strings, mirroring @helixid/sdk-js's AuditEvents.
class AuditEvents:
    VC_ISSUED = "VC_ISSUED"
    VC_PRESENTED = "VC_PRESENTED"
    VP_VERIFIED = "VP_VERIFIED"
    VP_REJECTED = "VP_REJECTED"
    AUTHZ_GRANTED = "AUTHZ_GRANTED"
    AUTHZ_DENIED = "AUTHZ_DENIED"
    TOOL_INVOKED = "TOOL_INVOKED"


class AuditEmitter:
    def emit(self, event: dict) -> None:  # pragma: no cover - overridden
        raise NotImplementedError


class _NoopEmitter(AuditEmitter):
    def emit(self, event: dict) -> None:
        return None


NOOP = _NoopEmitter()


class _HttpAuditEmitter(AuditEmitter):
    def __init__(
        self,
        endpoint: str,
        admin_api_key: str,
        service_did: str,
        service_name: str,
        on_error: Optional[Callable[[str], None]] = None,
    ) -> None:
        self._endpoint = endpoint
        self._admin_api_key = admin_api_key
        self._service_did = service_did
        self._service_name = service_name
        self._on_error = on_error

    def emit(self, event: dict) -> None:
        payload = {
            "serviceDid": self._service_did,
            "serviceName": self._service_name,
            "source": "sp",
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            **event,
        }

        def _send() -> None:
            try:
                res = requests.post(
                    self._endpoint,
                    json=payload,
                    headers={"x-admin-api-key": self._admin_api_key},
                    timeout=5,
                )
                if not res.ok and self._on_error:
                    self._on_error(f"audit {event.get('event')} rejected: HTTP {res.status_code}")
            except Exception as exc:  # noqa: BLE001 - best-effort sink
                if self._on_error:
                    self._on_error(f"audit {event.get('event')} failed: {exc}")

        threading.Thread(target=_send, daemon=True).start()


def create_audit_emitter(
    helix_api_url: Optional[str],
    admin_api_key: Optional[str],
    service_did: str,
    service_name: str,
    on_error: Optional[Callable[[str], None]] = None,
) -> AuditEmitter:
    if not helix_api_url or not admin_api_key:
        return NOOP
    endpoint = f"{helix_api_url.rstrip('/')}/v1/audit-log/events"
    return _HttpAuditEmitter(endpoint, admin_api_key, service_did, service_name, on_error)
