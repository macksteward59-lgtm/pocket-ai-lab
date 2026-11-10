const healthNode = document.getElementById("health");
const resultNode = document.getElementById("result");
const form = document.getElementById("review-form");
const allowlistNode = document.getElementById("allowlist");
const allowlistNote = document.getElementById("allowlist-note");
const downloadJson = document.getElementById("download-json");
const downloadMarkdown = document.getElementById("download-markdown");
let latest = null;

function show(node, text) {
  node.textContent = text;
}

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function refreshHealth() {
  try {
    const response = await fetch("/api/v1/health");
    const body = await response.json();
    if (body.authorized !== false) {
      show(healthNode, "Sidecar response did not keep authorized false. Ignoring it.");
      return;
    }
    const notes = Array.isArray(body.notes) && body.notes.length ? " " + body.notes.join(" ") : "";
    show(healthNode, "Sidecar status: " + body.status + ". authorized: false." + notes);
  } catch (error) {
    show(healthNode, "Sidecar health is unavailable. Start Pocket AI Lab on 127.0.0.1.");
  }
}

async function loadAllowlist() {
  try {
    const response = await fetch("/api/v1/governance/allowlist");
    const body = await response.json();
    if (body.authorized !== false) {
      show(allowlistNote, "Refusing an allowlist response that does not keep authorized false.");
      return;
    }
    allowlistNode.value = (body.hosts || []).join("\n");
  } catch (error) {
    show(allowlistNote, "The local allowlist could not be read.");
  }
}

document.getElementById("save-allowlist").addEventListener("click", async () => {
  const hosts = allowlistNode.value.split("\n").map(line => line.trim()).filter(Boolean);
  try {
    const response = await fetch("/api/v1/governance/allowlist", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hosts })
    });
    const body = await response.json();
    if (body.authorized !== false) {
      show(allowlistNote, "Refusing an allowlist response that does not keep authorized false.");
      return;
    }
    allowlistNode.value = (body.hosts || []).join("\n");
    show(allowlistNote, "Saved locally. authorized stays false. Targets are not contacted.");
  } catch (error) {
    show(allowlistNote, "The allowlist was not saved.");
  }
});

document.getElementById("upload").addEventListener("change", async event => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) document.getElementById("source-format").value = "nessus";
  else if (name.endsWith(".json")) document.getElementById("source-format").value = "zap";
  else if (name.endsWith(".xml")) document.getElementById("source-format").value = name.includes("zap") ? "zap" : "burp";
  document.getElementById("content").value = await file.text();
});

function renderResult(body) {
  const findings = body.review_package ? body.review_package.findings || [] : [];
  const violations = body.boundary_violations || [];
  const lines = [
    "state: " + (body.review_package ? body.review_package.state : "unknown"),
    "authorized: false",
    "requiresHumanApproval: true",
    "in-scope findings: " + findings.length,
    "boundary violations: " + violations.length
  ];
  for (const finding of findings) {
    lines.push("");
    lines.push("finding: " + finding.title);
    lines.push("severity: " + finding.severity);
    lines.push("host: " + (finding.asset ? finding.asset.base_domain : ""));
    lines.push("reproduction checklist:");
    for (const step of finding.reproduction_checklists || []) lines.push("- " + step);
  }
  if (violations.length) {
    lines.push("");
    lines.push("boundary violations:");
    for (const violation of violations) {
      const host = violation.asset ? violation.asset.base_domain : "";
      lines.push("- " + violation.reason + (host ? " (" + host + ")" : ""));
    }
  }
  if (body.evidence_markdown) {
    lines.push("");
    lines.push("evidence summary:");
    lines.push(body.evidence_markdown);
  }
  show(resultNode, lines.join("\n"));
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
    if (body.authorized !== false || (body.review_package && body.review_package.authorized !== false)) {
      show(resultNode, "Refusing a response that does not keep authorized false.");
      latest = null;
      downloadJson.disabled = true;
      downloadMarkdown.disabled = true;
      return;
    }
    latest = body;
    downloadJson.disabled = false;
    downloadMarkdown.disabled = !body.evidence_markdown;
    renderResult(body);
  } catch (error) {
    show(resultNode, "The local review request failed.");
  }
});

downloadJson.addEventListener("click", () => {
  if (!latest) return;
  download("governance-review.json", JSON.stringify(latest, null, 2), "application/json");
});

downloadMarkdown.addEventListener("click", () => {
  if (!latest || !latest.evidence_markdown) return;
  download("governance-review.md", latest.evidence_markdown, "text/markdown");
});

refreshHealth();
loadAllowlist();
setInterval(refreshHealth, 5000);
