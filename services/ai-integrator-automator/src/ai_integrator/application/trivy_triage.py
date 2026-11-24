"""Turn the dependency findings in a saved Trivy report into a local review draft."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

RequiredText = Annotated[str, Field(min_length=1)]


class _Vulnerability(BaseModel):
    advisory: RequiredText = Field(alias="VulnerabilityID")
    package: RequiredText = Field(alias="PkgName")
    installed_version: RequiredText = Field(alias="InstalledVersion")
    fixed_version: str | None = Field(None, alias="FixedVersion")
    severity: str | None = Field(None, alias="Severity")
    package_path: str | None = Field(None, alias="PkgPath")


class _Result(BaseModel):
    target: RequiredText = Field(alias="Target")
    ecosystem: str = Field(default="", alias="Type")
    vulnerabilities: list[_Vulnerability] = Field(default_factory=list, alias="Vulnerabilities")


class _Report(BaseModel):
    schema_version: Literal[2] = Field(alias="SchemaVersion")
    results: list[_Result] = Field(alias="Results")


class DependencyFinding(BaseModel):
    model_config = ConfigDict(frozen=True)

    target: str
    ecosystem: str
    package_path: str | None
    package: str
    installed_version: str
    advisory: str
    fixed_version: str | None
    severity: str | None


class TrivyReview(BaseModel):
    source_format: Literal["trivy"] = "trivy"
    findings: list[DependencyFinding]
    requires_human_approval: Literal[True] = True
    authorized: Literal[False] = False
    executes: Literal[False] = False


def review_trivy(content: str) -> TrivyReview:
    report = _Report.model_validate_json(content)
    # Keep provenance and remediation in the identity. Only identical observations collapse.
    observations = dict.fromkeys(
        DependencyFinding(
            target=result.target,
            ecosystem=result.ecosystem,
            package_path=item.package_path or None,
            package=item.package,
            installed_version=item.installed_version,
            advisory=item.advisory,
            fixed_version=item.fixed_version or None,
            severity=item.severity or None,
        )
        for result in report.results
        for item in result.vulnerabilities
    )
    return TrivyReview(findings=list(observations))
