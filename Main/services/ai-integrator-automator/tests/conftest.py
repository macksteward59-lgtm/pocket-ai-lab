import pytest


@pytest.fixture(autouse=True)
def isolated_allowlist(tmp_path, monkeypatch):
    monkeypatch.setenv("GOVERNANCE_ALLOWLIST_FILE", str(tmp_path / "allowlist.txt"))
