from ai_integrator.application.authorization_surface import analyze_authorization_surface

def test_fastapi_dependency_and_decorator_guards_are_inventory_signals_only():
    source = """
from fastapi import APIRouter, Depends
router = APIRouter()
def require_auth(): pass
@router.get("/private")
def private(user = Depends(require_auth)):
    return {"ok": True}
@router.post("/admin")
@requires_role("admin")
def admin():
    return {"ok": True}
"""
    report = analyze_authorization_surface(source)
    assert report.parser_status == "parsed"
    assert len(report.routes) == 2
    assert report.routes[0].guard_status == "local-guard-observed"
    assert "require_auth" in report.routes[0].guard_signals
    assert report.routes[1].guard_status == "local-guard-observed"
    assert report.authorized is False and report.executes is False

def test_missing_local_guard_is_not_a_vulnerability_finding():
    report = analyze_authorization_surface('@app.get("/public")\ndef public(): return "ok"')
    route = report.routes[0]
    assert route.guard_status == "no-local-guard-observed"
    assert any("not evidence" in item for item in report.limitations)

def test_flask_route_and_dynamic_route_are_conservative():
    report = analyze_authorization_surface('@app.route("/x", methods=["GET", "POST"])\n@login_required\ndef x(): pass\n@app.route(PATH)\ndef y(): pass')
    assert report.routes[0].methods == ["GET", "POST"]
    assert report.routes[0].guard_status == "local-guard-observed"
    assert report.routes[1].guard_status == "indeterminate"
    assert report.parser_status == "unsupported"

def test_malformed_and_truncated_sources_are_not_reported_clean():
    assert analyze_authorization_surface("def broken(:").parser_status == "syntax-error"
    assert analyze_authorization_surface("x = 1", limit=1).parser_status == "truncated"
