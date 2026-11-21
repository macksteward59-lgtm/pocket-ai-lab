import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ToolDirector } from "../../packages/intelligence/tooling/ToolDirector.ts";
import { ToolRegistry } from "../../packages/intelligence/security/tools.ts";
import { FileToolArtifactStore } from "../../runtime/adapters/director/FileToolArtifactStore.ts";
import { DockerPythonToolSandbox } from "../../runtime/adapters/director/DockerPythonToolSandbox.ts";
import { loadFrozenFixture } from "./fixture.mjs";
import { assertComparableRuns, assertContainersSettled } from "./evidence.mjs";

// This is actual Docker execution of explicitly fixture-authored source.
// It is a sandbox/lifecycle acceptance check, never live-model evidence.
export async function checkSandbox({ image, outputDirectory }) {
  const destination = path.resolve(outputDirectory);
  await mkdir(destination, { mode: 0o700 });
  const { fixture, digest } = await loadFrozenFixture();
  const report = { schemaVersion: 1, executionMode: "fixture-source-real-docker",
    startedAt: new Date().toISOString(), fixtureSHA256: digest, checks: [], accepted: false };
  const listener = createServer(socket => socket.end("host-only-service"));
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const hostPort = listener.address().port;
  process.env.POCKET_WORKSHOP_TEST_SECRET = "host-only-test-marker";
  const runs = [];
  const sandboxes = [];
  try {
    const sandbox = new DockerPythonToolSandbox({ image, cases: fixture.development });
    sandboxes.push(sandbox);
    report.preflight = await sandbox.preflight();
    assert.equal(report.preflight.executionMode, "docker");
    const store = new FileToolArtifactStore(path.join(destination, "artifacts"));
    const spec = { id: "fixture-utf8-prefix", name: "Fixture UTF-8 tool", purpose: "Contract execution only",
      specialists: ["ai-security"], change: "create",
      requirements: [fixture.taskSpec.slice(0, 900), fixture.taskSpec.slice(900)].filter(Boolean) };
    const fixedSource = "def truncate_utf8(text, byte_limit):\n    return text.encode('utf-8')[:byte_limit].decode('utf-8', errors='ignore')\n";
    let builds = 0;
    const director = new ToolDirector({ registry: new ToolRegistry(), store, sandbox, builder: {
      async build({ previous }) {
        builds += 1;
        if (builds === 1) return { files: { "candidate.py": fixture.baselineSource } };
        assert.equal(previous?.status, "quarantined");
        assert.equal(previous?.testSummary.testsRun, fixture.development.length);
        return { files: { "candidate.py": fixedSource } };
      }
    } });
    const baseline = await director.develop(spec);
    assertComparableRuns(sandbox.getRuns(), { caseCount: fixture.development.length,
      sourceSHA256: createHash("sha256").update(fixture.baselineSource).digest("hex"), version: 1 });
    assert.equal(baseline.status, "quarantined");
    const revised = await director.develop({ ...spec, change: "revise" });
    assert.equal(revised.status, "ready");
    assert.equal(revised.previousDigest, baseline.digest);
    assert.equal(revised.version, 2);
    const reopened = new FileToolArtifactStore(path.join(destination, "artifacts"));
    assert.equal((await reopened.getLatest(spec.id)).digest, revised.digest);
    runs.push(...sandbox.getRuns());
    report.checks.push({ name: "real-execution-revision-and-reopen", passed: true,
      baseline: baseline.testSummary, revision: revised.testSummary, versions: 2 });
    const isolationSource = [
      "import os, socket",
      "def truncate_utf8(text, byte_limit):",
      "    checks = [os.getuid() == 65534, 'POCKET_WORKSHOP_TEST_SECRET' not in os.environ]",
      "    try:",
      "        open('/opt/candidate.py', 'w').write('tamper')",
      "        checks.append(False)",
      "    except OSError:",
      "        checks.append(True)",
      "    try:",
      "        s = socket.create_connection(('127.0.0.1', " + hostPort + "), timeout=0.3)",
      "        s.close()",
      "        checks.append(False)",
      "    except OSError:",
      "        checks.append(True)",
      "    return 'isolated' if all(checks) else 'not-isolated'",
      ""
    ].join("\n");
    const probes = [
      { id: "isolation", source: isolationSource, expected: "isolated", shouldPass: true },
      { id: "wrong-output", source: "def truncate_utf8(text, byte_limit):\n    return 'wrong'\n",
        expected: "correct", shouldPass: false },
      { id: "timeout", source: "def truncate_utf8(text, byte_limit):\n    while True:\n        pass\n",
        expected: "", shouldPass: false, limits: { timeoutMs: 1000 } },
      { id: "output-cap", source: "import os\ndef truncate_utf8(text, byte_limit):\n    while True:\n        os.write(1, b'x' * 8192)\n",
        expected: "", shouldPass: false, limits: { maxOutputBytes: 1024 } }
    ];
    for (const probe of probes) {
      const actual = new DockerPythonToolSandbox({ image, cases: [{ id: probe.id, text: "input", byteLimit: 5, expected: probe.expected }],
        limits: probe.limits });
      sandboxes.push(actual);
      await actual.preflight();
      const artifact = await new ToolDirector({ registry: new ToolRegistry(), sandbox: actual,
        builder: { async build() { return { files: { "candidate.py": probe.source } }; } } })
        .develop({ ...spec, id: "probe-" + probe.id });
      const observed = actual.getRuns();
      assert.equal(observed.length, 1, "A negative check must execute, not fail preflight.");
      assert.equal(observed[0].executionMode, "docker");
      assert.equal(observed[0].cleanup.verifiedAbsent, true);
      assert.equal(artifact.testSummary?.passed, probe.shouldPass);
      if (probe.id === "wrong-output") {
        assert.equal(observed[0].actual, "wrong");
        assert.equal(observed[0].exitCode, 0);
        assert.equal(observed[0].timedOut, false);
        assert.equal(observed[0].outputLimitExceeded, false);
        assert.equal(observed[0].error, "host comparison failed");
      }
      if (probe.id === "timeout") assert.equal(observed[0].timedOut, true);
      if (probe.id === "output-cap") assert.equal(observed[0].outputLimitExceeded, true);
      runs.push(...observed);
      report.checks.push({ name: probe.id, passed: true, outcome: artifact.testSummary });
    }
    assert(runs.every(run => run.executionMode === "docker" && run.cleanup.verifiedAbsent));
    assert(runs.filter(run => run.toolId === spec.id && run.version === 2).every(run => run.passed));
    report.sourceSHA256 = { baseline: createHash("sha256").update(fixture.baselineSource).digest("hex"),
      revision: createHash("sha256").update(fixedSource).digest("hex") };
    report.accepted = true;
  } catch (error) {
    report.error = { name: error.name, message: error.message };
  } finally {
    delete process.env.POCKET_WORKSHOP_TEST_SECRET;
    await new Promise(resolve => listener.close(resolve));
    report.runs = sandboxes.flatMap(sandbox => sandbox.getRuns());
    try { assertContainersSettled(report.runs); }
    catch (error) { report.cleanupError = { name: error.name, message: error.message }; report.accepted = false; }
    report.completedAt = new Date().toISOString();
    await writeFile(path.join(destination, "sandbox-report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.POCKET_WORKSHOP_PYTHON_IMAGE || !process.env.POCKET_WORKSHOP_OUTPUT) {
    throw new Error("Set POCKET_WORKSHOP_PYTHON_IMAGE and a fresh POCKET_WORKSHOP_OUTPUT directory.");
  }
  const result = await checkSandbox({ image: process.env.POCKET_WORKSHOP_PYTHON_IMAGE,
    outputDirectory: process.env.POCKET_WORKSHOP_OUTPUT });
  console.log(JSON.stringify({ accepted: result.accepted, checks: result.checks, error: result.error }));
  if (!result.accepted) process.exitCode = 1;
}
