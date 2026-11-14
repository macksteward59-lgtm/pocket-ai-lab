from ai_integrator.application.cross_file_dataflow import ProjectSourceFile, analyze_python_project


def test_resolves_imported_function_and_binds_cross_file_source_to_sink():
    report = analyze_python_project([
        ProjectSourceFile(path="app/routes.py", source="from services.worker import run\nvalue = request.args.get('q')\nrun(value)\n"),
        ProjectSourceFile(path="app/services/worker.py", source="def run(value):\n    eval(value)\n"),
    ])
    assert report.parser_status == "parsed"
    assert len(report.resolved_imports) == 1
    assert len(report.observations) == 1
    signal = report.observations[0]
    assert signal.source_file == "app/routes.py"
    assert signal.source_line == 2
    assert signal.sink_file == "app/services/worker.py"
    assert signal.sink_line == 2
    assert signal.kind == "dynamic-exec"
    assert report.authorized is False
    assert report.executes is False


def test_follows_module_qualified_imported_function():
    report = analyze_python_project([
        ProjectSourceFile(path="app/routes.py", source="import services.worker\nvalue = request.args.get('q')\nservices.worker.run(value)\n"),
        ProjectSourceFile(path="app/services/worker.py", source="def run(value):\n    eval(value)\n"),
    ])
    assert len(report.observations) == 1
    assert report.observations[0].sink_file == "app/services/worker.py"


def test_unresolved_external_import_makes_report_partial():
    report = analyze_python_project([
        ProjectSourceFile(path="app/routes.py", source="from vendor.auth import check\nvalue = request.args.get('q')\n"),
    ])
    assert report.parser_status == "partial"
    assert report.unresolved_imports[0].reason == "external"


def test_keyword_call_is_not_misbound():
    report = analyze_python_project([
        ProjectSourceFile(path="app/routes.py", source="from services.worker import run\nvalue = request.args.get('q')\nrun(value=value)\n"),
        ProjectSourceFile(path="app/services/worker.py", source="def run(value):\n    eval(value)\n"),
    ])
    assert report.observations == []


def test_rejects_duplicate_and_traversal_paths():
    import pytest
    with pytest.raises(ValueError, match="relative path"):
        analyze_python_project([ProjectSourceFile(path="../routes.py", source="x=1")])
    with pytest.raises(ValueError, match="Duplicate"):
        analyze_python_project([
            ProjectSourceFile(path="app/a.py", source="x=1"),
            ProjectSourceFile(path="app/a.py", source="y=2"),
        ])


def test_syntax_error_does_not_produce_a_clean_report():
    report = analyze_python_project([
        ProjectSourceFile(path="app/a.py", source="def broken(:\n"),
    ])
    assert report.parser_status == "syntax-error"
    assert report.observations == []


def test_source_is_never_executed_and_evidence_is_unverified():
    report = analyze_python_project([
        ProjectSourceFile(path="app/routes.py", source="from services.worker import run\nvalue = request.args.get('q')\nrun(value)\n"),
        ProjectSourceFile(path="app/services/worker.py", source="def run(value):\n    eval(value)\n"),
    ])
    assert report.observations
    assert report.authorized is False
    assert report.executes is False

def test_ast_node_budget_stops_counting_at_the_configured_limit():
    source = chr(10).join(["value = 1"] * 6000)
    report = analyze_python_project([ProjectSourceFile(path="app/large.py", source=source)])
    assert report.parser_status == "unsupported"
    assert report.observations == []
    assert report.authorized is False
    assert report.executes is False
