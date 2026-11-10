"""Liveness payload. The HTTP status is always 200."""

import os

from cryptography.fernet import Fernet
from fastapi import APIRouter

router = APIRouter()


def health_payload() -> dict:
    try:
        notes: list[str] = []
        status = "healthy"
        key = os.environ.get("GOVERNANCE_FERNET_KEY", "").strip()
        if not key:
            status = "degraded"
            notes.append("Fernet key is not set; policy encryption is unavailable")
        else:
            try:
                Fernet(key.encode("utf-8"))
            except (ValueError, TypeError):
                status = "degraded"
                notes.append("Fernet key is not valid; policy encryption is unavailable")
        if not os.environ.get("GOVERNANCE_ALLOWLIST", "").strip():
            status = "degraded"
            notes.append("Allowlist is empty; every target stays out of scope")
        if os.environ.get("GOVERNANCE_AUTHORIZED", "false").strip().lower() != "false":
            status = "error"
            notes.append("GOVERNANCE_AUTHORIZED must be false")
        return {"status": status, "authorized": False, "notes": notes}
    except Exception:
        return {"status": "error", "authorized": False, "notes": ["health check failed"]}


@router.get("/api/v1/health")
def health() -> dict:
    return health_payload()
