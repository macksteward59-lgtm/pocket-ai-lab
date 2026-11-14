from ai_integrator.application.ast_dataflow import analyze_python_dataflow

def test_tracks_source_through_two_local_helper_functions():
    source = """def inner(value):
    eval(value)

def outer(argument):
    inner(argument)

def handler():
    user_value = request.args.get("q")
    outer(user_value)
"""
    report = analyze_python_dataflow(source)
    cross = [signal for signal in report.signals if signal.analysis_scope == "interprocedural"]
    assert len(cross) == 1
    signal = cross[0]
    assert signal.source_line == 8
    assert signal.sink_line == 2
    assert signal.sink_name == "eval"
    assert signal.source_excerpt == 'user_value = request.args.get("q")'
    assert signal.sink_excerpt == "eval(value)"
    assert report.authorized is False and report.executes is False

def test_does_not_infer_a_flow_when_helper_argument_is_untainted():
    source = """def helper(value):
    eval(value)

def handler():
    helper("constant")
"""
    report = analyze_python_dataflow(source)
    assert not [signal for signal in report.signals if signal.analysis_scope == "interprocedural"]

def test_helper_summary_does_not_cross_file_or_dynamic_dispatch():
    source = """def handler():
    value = request.args.get("q")
    plugin.execute(value)
"""
    report = analyze_python_dataflow(source)
    assert not [signal for signal in report.signals if signal.analysis_scope == "interprocedural"]

def test_keyword_helper_arguments_are_not_misbound_to_positional_summaries():
    source = """def helper(value):
    eval(value)

def handler():
    item = request.args.get("q")
    helper(value=item)
"""
    report = analyze_python_dataflow(source)
    assert report.parser_status == "unsupported"
    assert not [signal for signal in report.signals if signal.analysis_scope == "interprocedural"]
