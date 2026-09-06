# Per-SP persistence. Python port of sp-shared/store.ts -- deliberately a
# plain JSON file. Both the signed grant and the updated status list are
# persisted together: without the grant the SP cannot revoke by VC later,
# and without the status list the revocation bit is lost on restart.

from __future__ import annotations

import json
import os
from typing import Any, Dict, List


class SpStore:
    def __init__(self, file_path: str, state: Dict[str, Any]) -> None:
        self._file_path = file_path
        self._state = state

    @classmethod
    def open(cls, file_path: str, initial_status_list: Dict[str, Any]) -> "SpStore":
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                state = json.load(f)
            return cls(file_path, state)
        except FileNotFoundError:
            fresh = {"statusList": initial_status_list, "grants": []}
            store = cls(file_path, fresh)
            store._flush()
            return store

    def get_status_list(self) -> Dict[str, Any]:
        return self._state["statusList"]

    def get_grants(self) -> List[Dict[str, Any]]:
        return self._state["grants"]

    def record_grant(self, grant: Dict[str, Any], updated_status_list: Dict[str, Any]) -> None:
        self._state["grants"].append(grant)
        self._state["statusList"] = updated_status_list
        self._flush()

    def replace_status_list(self, status_list: Dict[str, Any]) -> None:
        self._state["statusList"] = status_list
        self._flush()

    def _flush(self) -> None:
        os.makedirs(os.path.dirname(self._file_path), exist_ok=True)
        with open(self._file_path, "w", encoding="utf-8") as f:
            json.dump(self._state, f, indent=2)
