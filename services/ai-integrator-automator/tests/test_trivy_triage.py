import json

import pytest
from fastapi.testclient import TestClient

from ai_integrator.main import create_app

URL = "/api/v1/governance/dependencies/trivy"


def submit(client, results):
    return client.post(URL, json={"content": json.dumps({"SchemaVersion": 2, "Results": results})})


def test_target_fix_pairs_survive_duplicate_and_repeat_import():
    client = TestClient(create_app())
    item = dict(VulnerabilityID="TEST-001", PkgName="demo", InstalledVersion="1.2",
                Severity="LOW", FixedVersion="1.3")
    results = [
        {"Target": "a/package-lock.json", "Type": "npm", "Vulnerabilities": [item, item]},
        {"Target": "b/package-lock.json", "Type": "npm", "Vulnerabilities": [
            {**item, "FixedVersion": "1.4"}, {**item, "VulnerabilityID": "TEST-002", "FixedVersion": ""},
        ]},
    ]
    first = submit(client, results)
    assert first.status_code == 200
    draft = first.json()
    assert submit(client, results).json() == draft
    assert draft["requires_human_approval"] and not draft["authorized"] and not draft["executes"]
    assert [(f["target"], f["advisory"], f["fixed_version"]) for f in draft["findings"]] == [
        ("a/package-lock.json", "TEST-001", "1.3"),
        ("b/package-lock.json", "TEST-001", "1.4"),
        ("b/package-lock.json", "TEST-002", None),
    ]
    assert all(f["package"] == "demo" and f["installed_version"] == "1.2" for f in draft["findings"])


def test_distinct_installed_paths_and_reported_fixes_survive():
    base = dict(VulnerabilityID="TEST-001", PkgName="demo", InstalledVersion="1", PkgPath="opt/a")
    result = {"Target": "image", "Type": "binary", "Vulnerabilities": [
        base, {**base, "PkgPath": "opt/b"}, {**base, "FixedVersion": "2"},
    ]}
    findings = submit(TestClient(create_app()), [result]).json()["findings"]
    assert [(f["package_path"], f["fixed_version"]) for f in findings] == [
        ("opt/a", None), ("opt/b", None), ("opt/a", "2"),
    ]


@pytest.mark.parametrize("results", [[], [{"Target": "lock", "Type": "npm"}]])
def test_valid_empty_dependency_results(results):
    assert submit(TestClient(create_app()), results).json()["findings"] == []


@pytest.mark.parametrize("text", [
    "not JSON", "[]", "{}", '{"SchemaVersion": 3, "Results": []}',
    '{"SchemaVersion": 2, "Results": [{}]}',
    '{"SchemaVersion": 2, "Results": [{"Target": "lock", "Vulnerabilities": [{}]}]}',
    " " * 2_000_001,
])
def test_invalid_report_rejected_without_returning_a_partial_draft(text):
    response = TestClient(create_app()).post(URL, json={"content": text})
    assert response.status_code == 422
    assert response.json()["authorized"] is False
    assert "findings" not in response.json()
