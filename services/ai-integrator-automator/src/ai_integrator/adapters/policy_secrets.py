"""Fernet policy blobs.

XOR is rejected. A missing or invalid key fails closed and is not replaced
with another cipher.
"""

import json

from cryptography.fernet import Fernet, InvalidToken

from ai_integrator.application.config_guard import ConfigGuardError, assert_runtime_config


class PolicySecretError(Exception):
    """The policy blob could not be protected or read with Fernet."""


class SecurePolicyLoader:
    def __init__(self, key: str | bytes) -> None:
        if not key or not str(key).strip():
            raise PolicySecretError("A Fernet key is required")
        material = key if isinstance(key, bytes) else key.encode("utf-8")
        try:
            self._fernet = Fernet(material)
        except (ValueError, TypeError) as exc:
            raise PolicySecretError("Fernet key is invalid") from exc

    def encrypt_policy(self, policy: dict) -> str:
        guarded = _guard(policy)
        blob = json.dumps(guarded, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return self._fernet.encrypt(blob).decode("utf-8")

    def decrypt_policy(self, token: str) -> dict:
        if not isinstance(token, str) or token.lower().startswith("xor:"):
            raise PolicySecretError("XOR cipher is rejected")
        try:
            raw = self._fernet.decrypt(token.encode("utf-8"))
        except (InvalidToken, TypeError, ValueError) as exc:
            raise PolicySecretError("Fernet token could not be read") from exc
        try:
            policy = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise PolicySecretError("Policy JSON is unreadable") from exc
        if not isinstance(policy, dict):
            raise PolicySecretError("Policy must be an object")
        return _guard(policy)


def _guard(policy: dict) -> dict:
    cipher = str(policy.get("cipher", "fernet")).strip().lower()
    if cipher != "fernet":
        raise PolicySecretError("XOR cipher is rejected" if cipher == "xor" else "only Fernet policy encryption is accepted")
    try:
        guarded = assert_runtime_config({**policy, "cipher": "fernet"})
    except ConfigGuardError as exc:
        raise PolicySecretError(str(exc)) from exc
    extra = {key: value for key, value in policy.items() if key not in guarded and key != "authorized"}
    return {**extra, **guarded}
