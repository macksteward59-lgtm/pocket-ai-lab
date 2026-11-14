from ai_integrator.application.ast_dataflow import analyze_python_dataflow


def test_direct_request_input_to_eval_is_reported_with_exact_lines():
    source = "value = request.args.get('code')\neval(value)\n"
    report = analyze_python_dataflow(source)
    assert report.parser_status == "parsed"
    assert report.authorized is False
    assert report.executes is False
    assert len(report.signals) == 1
    signal = report.signals[0]
    assert signal.kind == "dynamic-exec"
    assert signal.source_line == 1
    assert signal.sink_line == 2
    assert signal.source_excerpt == "value = request.args.get('code')"
    assert signal.sink_excerpt == "eval(value)"
    assert signal.variables == ["value"]


def test_assignment_propagation_tracks_simple_local_aliases():
    source = (
        "raw = request.form.get('query')\n"
        "normalized = raw.strip()\n"
        "payload = normalized\n"
        "subprocess.run(payload, shell=True)\n"
    )
    report = analyze_python_dataflow(source)
    assert len(report.signals) == 1
    assert report.signals[0].kind == "process-spawn"
    assert report.signals[0].source_line == 1
    assert report.signals[0].sink_line == 4
    assert set(report.signals[0].variables) == {"payload"}


def test_direct_source_to_sql_and_deserialization_sinks_are_reported():
    source = (
        "cursor.execute(request.args.get('sql'))\n"
        "pickle.loads(request.data)\n"
    )
    report = analyze_python_dataflow(source)
    assert [item.kind for item in report.signals] == ["sql-query", "deserialization"]
    assert [item.sink_line for item in report.signals] == [1, 2]


def test_comments_and_string_literals_do_not_create_ast_flows():
    source = (
        "# eval(request.args.get('x'))\n"
        "message = \"eval(request.args.get('x'))\"\n"
        "safe = 'hello'\n"
    )
    report = analyze_python_dataflow(source)
    assert report.signals == []


def test_unknown_branch_state_is_marked_partial_not_proven_safe():
    source = (
        "if condition:\n"
        "    value = request.args.get('x')\n"
        "    eval(value)\n"
    )
    report = analyze_python_dataflow(source)
    assert report.parser_status == "unsupported"
    assert len(report.signals) == 1
    assert any("branches and loops" in item for item in report.limitations)


def test_syntax_error_and_resource_bounds_are_inconclusive():
    malformed = analyze_python_dataflow("def broken(:\n")
    assert malformed.parser_status == "syntax-error"
    too_many = analyze_python_dataflow("x = 1\n" * 100, max_nodes=10)
    assert too_many.parser_status == "unsupported"
    assert too_many.signals == []


def test_truncated_source_never_claims_a_complete_analysis():
    report = analyze_python_dataflow("x = 1\n" * 20, limit=10)
    assert report.parser_status == "truncated"
    assert report.truncated is True
    assert report.signals == []
