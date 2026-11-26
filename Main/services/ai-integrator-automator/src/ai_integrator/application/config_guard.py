"""Reject runtime settings that would execute, probe, or authorize."""

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


class ConfigGuardError(Exception):
    """The sidecar configuration asked for a capability this process does not have."""


def assert_runtime_config(config: dict) -> dict:
    if config.get("authorized", False) is not False:
        raise ConfigGuardError("authorized must stay false")
    if config.get("execution_enabled") is True:
        raise ConfigGuardError("execution is disabled")
    if config.get("live_probes") is True:
        raise ConfigGuardError("live probes are disabled")
    if config.get("mint_tokens") is True:
        raise ConfigGuardError("token minting is disabled")
    cipher = str(config.get("cipher", "fernet")).strip().lower()
    if cipher != "fernet":
        raise ConfigGuardError("only Fernet policy encryption is accepted")
    host = str(config.get("host", "127.0.0.1")).strip()
    if host not in LOOPBACK_HOSTS:
        raise ConfigGuardError("sidecar must bind to loopback")
    return {
        "authorized": False,
        "execution_enabled": False,
        "live_probes": False,
        "mint_tokens": False,
        "cipher": "fernet",
        "host": host,
    }


def assert_loopback_host(host: str) -> str:
    if host not in LOOPBACK_HOSTS:
        raise SystemExit("Refusing to bind a non-loopback host")
    return host
