from pathlib import Path

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from ai_integrator.main import create_app

BURP = """<?xml version="1.0"?>
<issues>
  <issue>
    <name>Missing security header</name>
    <host>https://app.example.com/login</host>
    <severity>High</severity>
    <confidence>Certain</confidence>
  </issue>
</issues>
"""


def test_health_is_always_200(monkeypatch):
    monkeypatch.delenv("GOVERNANCE_FERNET_KEY", raising=False)
    monkeypatch.delenv("GOVERNANCE_ALLOWLIST", raising=False)
    response = TestClient(create_app()).get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in {"healthy", "degraded", "error"}
    assert body["authorized"] is False
    assert body["status"] == "degraded"

    monkeypatch.setenv("GOVERNANCE_FERNET_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("GOVERNANCE_ALLOWLIST", "app.example.com")
    ready = TestClient(create_app()).get("/api/v1/health")
    assert ready.status_code == 200
    assert ready.json()["status"] == "healthy"
    assert ready.json()["authorized"] is False

    monkeypatch.setenv("GOVERNANCE_FERNET_KEY", "not-a-key")
    degraded = TestClient(create_app()).get("/api/v1/health")
    assert degraded.status_code == 200
    assert degraded.json()["status"] == "degraded"
    assert "not-a-key" not in degraded.text


def test_review_and_analyze_routes(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("GOVERNANCE_ALLOWLIST", "app.example.com")
    monkeypatch.setenv("GOVERNANCE_SIDECAR_HOST", "127.0.0.1")
    client = TestClient(create_app())
    reviewed = client.post("/api/v1/governance/review", json={"source_format": "burp", "content": BURP})
    assert reviewed.status_code == 200
    body = reviewed.json()
    assert body["authorized"] is False
    assert body["review_package"]["state"] == "REVIEW_READY"
    assert body["review_package"]["authorized"] is False
    assert body["review_package"]["requires_human_approval"] is True
    assert body["review_package"]["findings"][0]["asset"]["is_in_scope"] is True
    assert body["boundary_violations"] == []
    assert '"authorized": true' not in reviewed.text
    assert '"authorized":true' not in reviewed.text

    listed = client.get("/api/v1/governance/reviews")
    assert listed.status_code == 200
    assert listed.json()["authorized"] is False
    assert listed.json()["reviews"][-1]["review_package"]["state"] == "REVIEW_READY"

    marker = tmp_path / "executed"
    source = f"import pathlib\npathlib.Path({str(marker)!r}).write_text('no')\n\ndef sample():\n    return 1\n"
    analyzed = client.post(
        "/api/v1/governance/analyze-source",
        json={"filename": "sample.py", "source": source},
    )
    assert analyzed.status_code == 200
    report = analyzed.json()
    assert report["authorized"] is False
    assert report["executes"] is False
    assert "pathlib" in report["context"]["imports"]
    assert "sample" in report["context"]["functions"]
    assert marker.exists() is False

    invalid = client.post("/api/v1/governance/review", json={"source_format": "live-probe", "content": BURP})
    assert invalid.status_code == 422
    assert invalid.json()["authorized"] is False
