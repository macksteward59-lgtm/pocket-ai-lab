from pathlib import Path

from ai_integrator.replay import replay_directory


def test_offline_fixtures_scope_example_hosts_only():
    fixtures = Path(__file__).resolve().parents[3] / "scripts" / "local-gguf" / "fixtures"
    report = replay_directory(fixtures)
    assert report["authorized"] is False
    assert report["allowlist"] == ["app.example.com"]
    assert [item["name"] for item in report["cases"]] == ["burp", "nessus", "zap"]
    for item in report["cases"]:
        assert item["authorized"] is False
        assert item["in_scope"] == 1
        assert item["violations"] == 1
        assert item["state"] == "REVIEW_READY"
        assert item["envelope"]["authorized"] is False
        assert "authorized: false" in item["envelope"]["evidence_markdown"]
        assert "payload" not in item["envelope"]["evidence_markdown"].lower()
        domains = []
        for finding in item["envelope"]["review_package"]["findings"]:
            domains.append(finding["asset"]["base_domain"])
        for violation in item["envelope"]["boundary_violations"]:
            domains.append(violation["asset"]["base_domain"])
        assert domains
        assert all(domain == "example.com" or domain.endswith(".example.com") for domain in domains)
