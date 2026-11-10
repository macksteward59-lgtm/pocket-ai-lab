from pathlib import Path

import pytest
from cryptography.fernet import Fernet

from ai_integrator.adapters.policy_secrets import PolicySecretError, SecurePolicyLoader
from ai_integrator.application.config_guard import ConfigGuardError, assert_loopback_host, assert_runtime_config
from ai_integrator.application.dependency_triage import triage_requirements
from ai_integrator.application.fuzz_scaffold import FuzzScaffoldRejected, build_fuzz_scaffold
from ai_integrator.application.source_parser import StaticContextExtractor
from ai_integrator.application.static_analyzer import analyze_source


def test_config_guard_keeps_execution_off():
    guarded = assert_runtime_config({"host": "localhost", "cipher": "fernet"})
    assert guarded["authorized"] is False
    assert guarded["live_probes"] is False
    assert guarded["mint_tokens"] is False
    with pytest.raises(ConfigGuardError):
        assert_runtime_config({"authorized": True})
    with pytest.raises(ConfigGuardError):
        assert_runtime_config({"cipher": "xor"})
    with pytest.raises(ConfigGuardError):
        assert_runtime_config({"live_probes": True})
    with pytest.raises(ConfigGuardError):
        assert_runtime_config({"mint_tokens": True})
    with pytest.raises(ConfigGuardError):
        assert_runtime_config({"execution_enabled": True})
    with pytest.raises(ConfigGuardError):
        assert_runtime_config({"host": "0.0.0.0"})
    with pytest.raises(SystemExit):
        assert_loopback_host("10.1.1.1")


def test_fernet_round_trip_and_xor_rejection():
    loader = SecurePolicyLoader(Fernet.generate_key().decode())
    token = loader.encrypt_policy({"cipher": "fernet", "host": "127.0.0.1", "allowlist": ["app.example.com"]})
    loaded = loader.decrypt_policy(token)
    assert loaded["authorized"] is False
    assert loaded["cipher"] == "fernet"
    assert loaded["allowlist"] == ["app.example.com"]
    with pytest.raises(PolicySecretError):
        loader.decrypt_policy("xor:abcdef")
    with pytest.raises(PolicySecretError):
        loader.encrypt_policy({"cipher": "xor", "host": "127.0.0.1"})
    with pytest.raises(PolicySecretError):
        SecurePolicyLoader("")
    flipped = list(token)
    flipped[10] = "A" if flipped[10] != "A" else "B"
    with pytest.raises(PolicySecretError):
        loader.decrypt_policy("".join(flipped))


def test_static_analysis_does_not_execute(tmp_path: Path):
    marker = tmp_path / "should-not-exist"
    source = (
        "import pathlib\n"
        f"pathlib.Path({str(marker)!r}).write_text('executed')\n"
        "def risky():\n"
        "    eval('1')\n"
        "    os.system('true')\n"
    )
    report = analyze_source(source)
    context = StaticContextExtractor().extract(source)
    assert marker.exists() is False
    assert report.authorized is False
    assert report.executes is False
    assert any(item.kind == "dynamic-exec" for item in report.observations)
    assert any(item.kind == "process-spawn" for item in report.observations)
    assert "pathlib" in context.imports
    assert "risky" in context.functions


def test_dependency_triage_does_not_fetch_and_fuzz_scaffold_has_no_payloads():
    triage = triage_requirements("fastapi==0.115.0\nrequests\n--index-url http://example.invalid/simple\n")
    by_name = {note.name: note for note in triage.notes}
    assert by_name["fastapi"].pinned is True
    assert by_name["requests"].pinned is False
    assert triage.executes is False
    assert triage.authorized is False
    scaffold = build_fuzz_scaffold(["userId", "user id", "../etc"])
    assert scaffold["authorized"] is False
    assert scaffold["executes"] is False
    assert scaffold["payloads"] == []
    assert scaffold["parameters"] == ["userId"]
    with pytest.raises(FuzzScaffoldRejected):
        build_fuzz_scaffold(["userId"], emit_payloads=True)
