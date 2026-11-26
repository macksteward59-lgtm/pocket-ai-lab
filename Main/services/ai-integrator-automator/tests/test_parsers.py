from ai_integrator.ports.telemetry_port import BurpXmlAdapter, NessusParserAdapter, ZapParserAdapter

BURP = """<?xml version="1.0"?>
<issues burpVersion="2024.1">
  <issue>
    <name>Missing security header</name>
    <host ip="203.0.113.10">https://app.example.com:443</host>
    <path>/login</path>
    <severity>High</severity>
    <confidence>Certain</confidence>
    <type>5243392</type>
    <remediationBackground>Send the header from the application.</remediationBackground>
    <issueDetail>The response did not include the header.</issueDetail>
    <in_scope>true</in_scope>
  </issue>
</issues>
"""

NESSUS = """Plugin ID,CVE,Risk,Host,Protocol,Port,Name,Synopsis,Description,Solution
10001,CVE-2024-0001,High,app.example.com,tcp,443,TLS config,Weak setting,The scanner observed a weak setting,Disable the weak setting
"""

ZAP_JSON = """{
  "site": [{
    "@name": "https://app.example.com",
    "alerts": [{
      "name": "Missing header",
      "alert": "Content Security Policy Header Not Set",
      "riskdesc": "High (Medium)",
      "confidence": "Medium",
      "uri": "https://app.example.com/login",
      "param": "id",
      "solution": "Add the header"
    }]
  }]
}"""


def test_burp_parser_normalizes_and_stays_out_of_scope():
    findings = BurpXmlAdapter().parse(BURP)
    assert len(findings) == 1
    finding = findings[0]
    assert finding.title == "Missing security header"
    assert finding.severity == "High"
    assert finding.asset.base_domain == "app.example.com"
    assert finding.asset.ip_address == "203.0.113.10"
    assert finding.asset.port == 443
    assert finding.asset.is_in_scope is False
    assert finding.authorized is False
    assert finding.reproduction_checklists
    assert "does not contact the target" in finding.reproduction_checklists[1]


def test_burp_malformed_and_xxe_return_empty():
    assert BurpXmlAdapter().parse("this is not xml <<<") == []
    assert BurpXmlAdapter().parse("") == []
    assert BurpXmlAdapter().parse("\x00<xml>") == []
    xxe = """<?xml version="1.0"?>
    <!DOCTYPE issues [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
    <issues><issue><name>&xxe;</name><host>https://app.example.com</host></issue></issues>
    """
    assert BurpXmlAdapter().parse(xxe) == []


def test_nessus_parser_and_malformed_csv():
    findings = NessusParserAdapter().parse(NESSUS)
    assert len(findings) == 1
    assert findings[0].asset.base_domain == "app.example.com"
    assert findings[0].asset.port == 443
    assert findings[0].asset.is_in_scope is False
    assert findings[0].vulnerability_type == "CVE-2024-0001"
    assert NessusParserAdapter().parse("not,a,csv\njust,text") == []
    assert NessusParserAdapter().parse("") == []
    assert NessusParserAdapter().parse("\x00") == []


def test_zap_json_and_malformed_input():
    findings = ZapParserAdapter().parse(ZAP_JSON)
    assert len(findings) == 1
    assert findings[0].affected_parameters == ["id"]
    assert findings[0].asset.is_in_scope is False
    assert ZapParserAdapter().parse("{") == []
    assert ZapParserAdapter().parse("<not xml") == []
    assert ZapParserAdapter().parse("plain text") == []


def test_parsers_do_not_raise_on_unexpected_types():
    for parser in (BurpXmlAdapter(), NessusParserAdapter(), ZapParserAdapter()):
        assert parser.parse(None) == []  # type: ignore[arg-type]
        assert parser.parse(123) == []  # type: ignore[arg-type]
