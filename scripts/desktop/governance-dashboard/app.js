const healthNode = document.getElementById("health");
const resultNode = document.getElementById("result");
const form = document.getElementById("review-form");

function show(node, text) {
  node.textContent = text;
}

async function refreshHealth() {
  try {
    const response = await fetch("/api/v1/health");
    const body = await response.json();
    if (body.authorized !== false) {
      show(healthNode, "Sidecar response did not keep authorized false. Ignoring it.");
      return;
    }
    show(healthNode, "Sidecar status: " + body.status + ". authorized: false.");
  } catch (error) {
    show(healthNode, "Sidecar health is unavailable. Start the pipeline on 127.0.0.1.");
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const payload = {
    source_format: document.getElementById("source-format").value,
    content: document.getElementById("content").value
  };
  try {
    const response = await fetch("/api/v1/governance/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (body.authorized !== false) {
      show(resultNode, "Refusing a response that does not keep authorized false.");
      return;
    }
    const findings = body.review_package ? body.review_package.findings || [] : [];
    const violations = body.boundary_violations || [];
    const lines = [
      "state: " + (body.review_package ? body.review_package.state : "unknown"),
      "authorized: false",
      "in-scope findings: " + findings.length,
      "boundary violations: " + violations.length
    ];
    for (const finding of findings) {
      lines.push("finding: " + finding.title);
      for (const step of finding.reproduction_checklists || []) lines.push("- " + step);
    }
    for (const violation of violations) lines.push("violation: " + violation.reason);
    show(resultNode, lines.join("\n"));
  } catch (error) {
    show(resultNode, "The local review request failed.");
  }
});

refreshHealth();
setInterval(refreshHealth, 5000);
