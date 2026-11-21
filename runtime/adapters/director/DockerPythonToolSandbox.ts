import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolArtifact, ToolBuildSpec, ToolSandbox, ToolTestSummary } from "../../../packages/intelligence/tooling/ToolDirector";

export interface PythonSandboxCase {
  readonly id: string;
  readonly text: string;
  readonly byteLimit: number;
  readonly expected: string;
}

export interface DockerPythonSandboxLimits {
  readonly timeoutMs: number;
  readonly memoryMB: number;
  readonly cpus: number;
  readonly pidsLimit: number;
  readonly maxOutputBytes: number;
  readonly maxSourceBytes: number;
}

/** The injectable port is for deterministic tests, never live execution evidence. */
export interface DockerProcessRequest {
  readonly command: "docker";
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly stdin?: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}
export interface DockerProcessResult {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly outputLimitExceeded: boolean;
  readonly durationMs: number;
  readonly spawnError?: string;
  /** No process close was observed after requesting termination. */
  readonly transportUnsettled?: boolean;
  readonly killRequested?: boolean;
}
export type DockerProcessAdapter = (request: DockerProcessRequest) => Promise<DockerProcessResult>;

export interface DockerPythonToolSandboxOptions {
  /** A repository@sha256 reference, without a mutable tag. No automatic pull. */
  readonly image: string;
  readonly cases: readonly PythonSandboxCase[];
  readonly limits?: Partial<DockerPythonSandboxLimits>;
  /** Host-only development feedback. Keep false for frozen held-out evaluation. */
  readonly includeCaseFeedback?: boolean;
  /** Opt-in compiler/process diagnostics for development only; requires includeCaseFeedback. */
  readonly includeFailureDiagnostics?: boolean;
  readonly testProcessAdapter?: DockerProcessAdapter;
}

export interface DockerSandboxPreflight {
  readonly executionMode: "docker" | "test-double";
  readonly endpoint: string;
  readonly daemonId: string;
  readonly serverVersion: string;
  readonly image: string;
  readonly imageId: string;
  readonly repoDigests: readonly string[];
  readonly architecture: string;
  readonly os: "linux";
  readonly helperSha256: string;
}

export interface DockerPythonCaseRun {
  readonly executionMode: "docker" | "test-double";
  readonly caseId: string;
  readonly toolId: string;
  readonly version: number;
  readonly artifactDigest: string;
  readonly sourceSha256: string;
  readonly inputSha256: string;
  readonly limits: DockerPythonSandboxLimits;
  readonly image: string;
  readonly imageId: string;
  readonly daemonId: string;
  readonly containerName: string;
  readonly containerId: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly outputLimitExceeded: boolean;
  readonly transportUnsettled: boolean;
  readonly cliKillRequested: boolean;
  readonly oomKilled: boolean | null;
  readonly stdout: string | null;
  readonly stderr: string | null;
  readonly stdoutBase64: string;
  readonly stderrBase64: string;
  readonly actual: string | null;
  readonly expectedSha256: string;
  readonly passed: boolean;
  readonly error: string | null;
  readonly cleanup: {
    readonly killAttempted: boolean;
    readonly removeAttempted: boolean;
    readonly verifiedAbsent: boolean;
    readonly error: string | null;
  };
}

const DEFAULT_LIMITS: DockerPythonSandboxLimits = Object.freeze({
  timeoutMs: 5_000, memoryMB: 128, cpus: 0.5, pidsLimit: 16,
  maxOutputBytes: 32_768, maxSourceBytes: 32_768
});
const CONTROL_TIMEOUT_MS = 10_000;
const CONTROL_OUTPUT_BYTES = 16_384;
const IMAGE_PATTERN = /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

// This trusted helper contains no answers, suite, case IDs, repository paths or credentials.
// It runs inside Docker only. Host grading does not trust any candidate test claims.
const PYTHON_RUNNER = `import contextlib, importlib.util, json, os, sys, traceback
_write, _dumps, _type = os.write, json.dumps, type
_stderr = sys.stderr
try:
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536:
        raise ValueError("input too large")
    data = json.loads(raw)
    if _type(data) is not dict or set(data) != {"text", "byteLimit"}:
        raise ValueError("invalid input")
    if _type(data["text"]) is not str or _type(data["byteLimit"]) is not int:
        raise ValueError("invalid input types")
    if len(data["text"].encode("utf-8")) > 4096 or not 0 <= data["byteLimit"] <= 4096:
        raise ValueError("input outside fixed limits")
    with contextlib.redirect_stdout(_stderr):
        spec = importlib.util.spec_from_file_location("candidate", "/opt/candidate.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        value = module.truncate_utf8(data["text"], data["byteLimit"])
    if _type(value) is not str:
        raise ValueError("candidate must return a string")
    encoded = (_dumps({"result": value}, ensure_ascii=False, separators=(",", ":")) + "\\n").encode("utf-8")
    _write(1, encoded)
except BaseException:
    traceback.print_exc(file=_stderr)
    sys.exit(1)
`;

/** A narrow, disposable Python function sandbox; never installs or activates a tool. */
export class DockerPythonToolSandbox implements ToolSandbox {
  private readonly image: string;
  private readonly cases: readonly PythonSandboxCase[];
  private readonly limits: DockerPythonSandboxLimits;
  private readonly processAdapter: DockerProcessAdapter;
  private readonly executionMode: "docker" | "test-double";
  private readonly includeCaseFeedback: boolean;
  private readonly includeFailureDiagnostics: boolean;
  private readonly contextEnvironment: Readonly<Record<string, string>>;
  private readonly runs: DockerPythonCaseRun[] = [];
  private busy = false;
  private transportUnsettled = false;

  constructor(options: DockerPythonToolSandboxOptions) {
    if (!options || !IMAGE_PATTERN.test(options.image)) {
      throw new Error("A digest-only repository@sha256 image reference is required");
    }
    this.image = options.image;
    if (options.includeCaseFeedback !== undefined && typeof options.includeCaseFeedback !== "boolean") {
      throw new Error("includeCaseFeedback must be an explicit host Boolean");
    }
    this.includeCaseFeedback = options.includeCaseFeedback ?? false;
    if (options.includeFailureDiagnostics !== undefined && typeof options.includeFailureDiagnostics !== "boolean") {
      throw new Error("includeFailureDiagnostics must be an explicit host Boolean");
    }
    this.includeFailureDiagnostics = options.includeFailureDiagnostics ?? false;
    if (this.includeFailureDiagnostics && !this.includeCaseFeedback) {
      throw new Error("Failure diagnostics require host development case feedback");
    }
    if (!Array.isArray(options.cases) || options.cases.length < 1 || options.cases.length > 32) {
      throw new Error("Provide between 1 and 32 host-owned cases");
    }
    const ids = new Set<string>();
    this.cases = Object.freeze(options.cases.map(test => {
      if (!test || typeof test.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(test.id) || ids.has(test.id)) {
        throw new Error("Case identifiers must be unique and bounded");
      }
      scalarString(test.text, 4096, "case text");
      scalarString(test.expected, 4096, "expected result");
      boundedInteger(test.byteLimit, 0, 4096, "byteLimit");
      ids.add(test.id);
      return Object.freeze({ id: test.id, text: test.text, byteLimit: test.byteLimit, expected: test.expected });
    }));
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    boundedInteger(limits.timeoutMs, 100, 15_000, "timeoutMs");
    boundedInteger(limits.memoryMB, 32, 256, "memoryMB");
    boundedInteger(limits.pidsLimit, 4, 32, "pidsLimit");
    boundedInteger(limits.maxOutputBytes, 256, 65_536, "maxOutputBytes");
    boundedInteger(limits.maxSourceBytes, 1, 65_536, "maxSourceBytes");
    if (!Number.isFinite(limits.cpus) || limits.cpus < 0.1 || limits.cpus > 1) throw new Error("cpus outside fixed limits");
    this.limits = Object.freeze(limits);
    this.processAdapter = options.testProcessAdapter ?? runDockerProcess;
    this.executionMode = options.testProcessAdapter ? "test-double" : "docker";
    const environment: Record<string, string> = {};
    for (const key of ["PATH", "HOME", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_HOST"]) {
      if (process.env[key]) environment[key] = process.env[key]!;
    }
    if (process.env.DOCKER_TLS_VERIFY || process.env.DOCKER_CERT_PATH) {
      throw new Error("Remote/TLS Docker configuration is not admitted");
    }
    if (environment.DOCKER_HOST) localEndpoint(environment.DOCKER_HOST);
    this.contextEnvironment = Object.freeze(environment);
  }

  getRuns(): DockerPythonCaseRun[] {
    return JSON.parse(JSON.stringify(this.runs)) as DockerPythonCaseRun[];
  }

  async preflight(): Promise<DockerSandboxPreflight> {
    if (this.transportUnsettled) throw new Error("Docker CLI settlement is unknown; this sandbox instance cannot be reused");
    if (this.runs.some(run => !run.cleanup.verifiedAbsent || run.cleanup.error !== null)) {
      throw new Error("A prior sandbox run has unresolved cleanup; this instance cannot be reused");
    }
    const context = await this.command(["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"], undefined, this.contextEnvironment);
    const configuredEndpoint = localEndpoint(parseSuccessfulJSON(context, "Docker context"));
    const endpoint = localEndpoint(this.contextEnvironment.DOCKER_HOST ?? configuredEndpoint);
    const root = await privateDirectory();
    try {
      const config = join(root, "docker-config");
      await mkdir(config, { mode: 0o700 });
      const prefix = ["--host", endpoint, "--config", config];
      const daemon = parseSuccessfulJSON(await this.command([...prefix, "info", "--format",
        '{"id":{{json .ID}},"osType":{{json .OSType}},"serverVersion":{{json .ServerVersion}},"securityOptions":{{json .SecurityOptions}},"memoryLimit":{{json .MemoryLimit}},"swapLimit":{{json .SwapLimit}},"cpuCfsPeriod":{{json .CPUCfsPeriod}},"cpuCfsQuota":{{json .CPUCfsQuota}},"pidsLimit":{{json .PidsLimit}}}']), "Docker daemon");
      if (!daemon || daemon.osType !== "linux" || typeof daemon.id !== "string" || !daemon.id ||
          typeof daemon.serverVersion !== "string" || !Array.isArray(daemon.securityOptions) ||
          !daemon.securityOptions.some((entry: unknown) => typeof entry === "string" && entry.includes("name=seccomp") && !entry.includes("unconfined"))) {
        throw new Error("A local Linux Docker daemon with seccomp is required");
      }
      if (["memoryLimit", "swapLimit", "cpuCfsPeriod", "cpuCfsQuota", "pidsLimit"].some(key => daemon[key] !== true)) {
        throw new Error("Docker daemon does not support every required memory/swap/CPU/PID limit");
      }
      const inspected = parseSuccessfulJSON(await this.command([...prefix, "image", "inspect", this.image, "--format",
        '{"id":{{json .Id}},"repoDigests":{{json .RepoDigests}},"os":{{json .Os}},"architecture":{{json .Architecture}}}']), "Pinned local image");
      if (!inspected || !SHA256_PATTERN.test(inspected.id) || inspected.os !== "linux" ||
          typeof inspected.architecture !== "string" || !Array.isArray(inspected.repoDigests) ||
          !inspected.repoDigests.some((digest: unknown) => typeof digest === "string" && normalizeImage(digest) === normalizeImage(this.image))) {
        throw new Error("Local image identity does not match the exact pinned digest");
      }
      return Object.freeze({ executionMode: this.executionMode, endpoint, daemonId: daemon.id,
        serverVersion: daemon.serverVersion, image: this.image, imageId: inspected.id,
        repoDigests: Object.freeze([...inspected.repoDigests]), architecture: inspected.architecture,
        os: "linux", helperSha256: sha256(PYTHON_RUNNER) });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  async test(input: { spec: ToolBuildSpec; artifact: ToolArtifact }): Promise<ToolTestSummary> {
    if (this.transportUnsettled) throw new Error("Docker CLI settlement is unknown; this sandbox instance cannot be reused");
    if (this.runs.some(run => !run.cleanup.verifiedAbsent || run.cleanup.error !== null)) {
      throw new Error("A prior sandbox run has unresolved cleanup; this instance cannot be reused");
    }
    if (this.busy) throw new Error("Sandbox permits only one active test run");
    if (this.runs.length + this.cases.length > 256) throw new Error("Sandbox run-record budget exhausted");
    const artifact = input?.artifact;
    const files = artifact?.files;
    if (!files || Object.keys(files).length !== 1 || !Object.prototype.hasOwnProperty.call(files, "candidate.py")) {
      throw new Error("Exactly one candidate.py file is admitted");
    }
    const source = Object.getOwnPropertyDescriptor(files, "candidate.py")?.value;
    scalarString(source, this.limits.maxSourceBytes, "candidate source");
    if (!source.trim()) throw new Error("Candidate source is empty");
    if (typeof artifact.digest !== "string" || !/^[a-f0-9]{64}$/.test(artifact.digest) ||
        typeof artifact.toolId !== "string" || artifact.toolId !== input.spec?.id ||
        !Number.isSafeInteger(artifact.version) || artifact.version < 1) throw new Error("Invalid artifact identity");
    const identity = { toolId: artifact.toolId, version: artifact.version, artifactDigest: artifact.digest };
    this.busy = true;
    try {
      const preflight = await this.preflight();
      const current: DockerPythonCaseRun[] = [];
      for (const test of this.cases) {
        const run = await this.runCase(preflight, source, identity, test);
        current.push(run);
        this.runs.push(run);
        if (!run.cleanup.verifiedAbsent || run.cleanup.error !== null) break;
      }
      const testsPassed = current.filter(run => run.passed).length;
      return { passed: current.length === this.cases.length && testsPassed === current.length,
        testsRun: current.length, testsPassed,
        findings: current.filter(run => !run.passed).map(run => this.includeCaseFeedback
          ? this.includeFailureDiagnostics && hasProcessDiagnostic(run)
            ? diagnosticCaseFeedback(this.cases.find(test => test.id === run.caseId)!, run)
            : caseFeedback(this.cases.find(test => test.id === run.caseId)!, run)
          : boundedUTF8(`${run.caseId}: ${run.error ?? "host comparison failed"}`, 500)),
        completedAt: new Date().toISOString() };
    } finally {
      this.busy = false;
    }
  }

  private async runCase(preflight: DockerSandboxPreflight, source: string,
    identity: { toolId: string; version: number; artifactDigest: string }, test: PythonSandboxCase): Promise<DockerPythonCaseRun> {
    const started = Date.now();
    const containerName = `pocket-tool-${randomUUID()}`;
    const root = await privateDirectory();
    const config = join(root, "docker-config");
    const candidatePath = join(root, "candidate.py");
    const helperPath = join(root, "python-runner.py");
    const prefix = ["--host", preflight.endpoint, "--config", config];
    let containerId: string | null = null;
    let attemptedCreate = false;
    let creationUncertain = false;
    let processResult: DockerProcessResult | undefined;
    let error: string | null = null;
    let actual: string | null = null;
    let oomKilled: boolean | null = null;
    let passed = false;
    let cleanup = { killAttempted: false, removeAttempted: false, verifiedAbsent: false, error: null as string | null };
    try {
      await mkdir(config, { mode: 0o700 });
      await writeFile(candidatePath, source, { mode: 0o644, flag: "wx" });
      await writeFile(helperPath, PYTHON_RUNNER, { mode: 0o644, flag: "wx" });
      await chmod(candidatePath, 0o644);
      await chmod(helperPath, 0o644);
      attemptedCreate = true;
      // Sending create can reach the daemon even if its acknowledgement is lost
      // or the CLI reports failure. Only a valid successful ID closes this window.
      creationUncertain = true;
      const created = await this.command([...prefix, "create", "--name", containerName,
        "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
        "--user=65534:65534", `--pids-limit=${this.limits.pidsLimit}`, `--memory=${this.limits.memoryMB}m`,
        `--memory-swap=${this.limits.memoryMB}m`, `--cpus=${this.limits.cpus}`, "--ipc=none", "--cgroupns=private",
        "--ulimit=core=0:0", "--ulimit=nofile=64:64", "--ulimit=fsize=65536:65536", "--log-driver=none",
        "--interactive", "--workdir=/", "--entrypoint=python",
        "--mount", `type=bind,source=${candidatePath},target=/opt/candidate.py,readonly`,
        "--mount", `type=bind,source=${helperPath},target=/opt/python-runner.py,readonly`,
        preflight.imageId, "-I", "-B", "/opt/python-runner.py"]);
      requireSuccess(created, "Container creation");
      const createdId = decode(created.stdout).trim();
      if (!/^[a-f0-9]{64}$/.test(createdId)) throw new Error("Docker returned an invalid container identifier");
      containerId = createdId;
      creationUncertain = false;
      processResult = await this.command([...prefix, "start", "--attach", "--interactive", containerId],
        JSON.stringify({ text: test.text, byteLimit: test.byteLimit }), undefined, this.limits.timeoutMs, this.limits.maxOutputBytes);
      requireSuccess(processResult, "Candidate process");
      const state = parseSuccessfulJSON(await this.command([...prefix, "container", "inspect", containerId, "--format",
        '{"imageId":{{json .Image}},"running":{{json .State.Running}},"exitCode":{{json .State.ExitCode}},"oomKilled":{{json .State.OOMKilled}}}']), "Container completion");
      if (!state || state.imageId !== preflight.imageId || state.running !== false ||
          typeof state.oomKilled !== "boolean" || state.exitCode !== 0) throw new Error("Container completion identity/state mismatch");
      oomKilled = state.oomKilled;
      if (oomKilled) throw new Error("Candidate exceeded container memory limit");
      actual = parseCandidateResult(processResult.stdout);
      passed = actual === test.expected;
      if (!passed) error = "host comparison failed";
    } catch (caught) {
      error = boundedError(caught);
    } finally {
      if (attemptedCreate) cleanup = await this.cleanup(prefix, containerName);
      else cleanup = { ...cleanup, verifiedAbsent: true };
      if (creationUncertain) cleanup = { ...cleanup, verifiedAbsent: false,
        error: "Creation was not acknowledged with a valid successful ID; a later daemon-side creation cannot be ruled out" };
      if (this.transportUnsettled) cleanup = { ...cleanup, verifiedAbsent: false,
        error: "A Docker CLI process did not settle; container absence does not establish complete cleanup" };
      if (!cleanup.verifiedAbsent) { passed = false; error = `Container cleanup unverified: ${cleanup.error ?? "unknown failure"}`; }
      try { await rm(root, { recursive: true, force: true }); }
      catch (caught) {
        passed = false;
        error = `Private workspace cleanup failed: ${boundedError(caught)}`;
        // Preserve the observed container absence while recording incomplete
        // overall teardown. The host gate also requires cleanup.error=null.
        cleanup = { ...cleanup, error: [cleanup.error, error].filter(Boolean).join("; ") };
      }
    }
    return Object.freeze({ executionMode: this.executionMode, caseId: test.id, ...identity,
      sourceSha256: sha256(source), image: preflight.image, imageId: preflight.imageId, daemonId: preflight.daemonId,
      inputSha256: sha256(JSON.stringify({ text: test.text, byteLimit: test.byteLimit })), limits: this.limits,
      containerName, containerId, startedAt: new Date(started).toISOString(), completedAt: new Date().toISOString(),
      durationMs: Date.now() - started, exitCode: processResult?.exitCode ?? null, signal: processResult?.signal ?? null,
      timedOut: processResult?.timedOut ?? false, outputLimitExceeded: processResult?.outputLimitExceeded ?? false,
      transportUnsettled: this.transportUnsettled, cliKillRequested: processResult?.killRequested ?? false,
      oomKilled, stdout: tryDecode(processResult?.stdout), stderr: tryDecode(processResult?.stderr),
      stdoutBase64: processResult?.stdout.toString("base64") ?? "", stderrBase64: processResult?.stderr.toString("base64") ?? "",
      actual, expectedSha256: sha256(test.expected), passed, error, cleanup: Object.freeze(cleanup) });
  }

  private async cleanup(prefix: string[], name: string): Promise<DockerPythonCaseRun["cleanup"]> {
    // All three operations are attempted even if a Docker command fails. Failure to
    // list the now-absent container is never interpreted as successful cleanup.
    let error: string | null = null;
    try { await this.command([...prefix, "kill", "--signal=KILL", name]); } catch (caught) { error = boundedError(caught); }
    try { await this.command([...prefix, "rm", "--force", name]); } catch (caught) { error = boundedError(caught); }
    try {
      const remaining = await this.command([...prefix, "container", "ls", "--all", "--no-trunc",
        "--filter", `name=^/${name}$`, "--format", "{{.ID}}"]);
      requireSuccess(remaining, "Cleanup verification");
      if (decode(remaining.stdout).trim()) throw new Error("Container remains after forced removal");
      return { killAttempted: true, removeAttempted: true, verifiedAbsent: true, error: null };
    } catch (caught) {
      return { killAttempted: true, removeAttempted: true, verifiedAbsent: false, error: boundedError(caught) || error };
    }
  }

  private async command(args: readonly string[], stdin?: string, env?: Readonly<Record<string, string>>,
    timeoutMs = CONTROL_TIMEOUT_MS, maxOutputBytes = CONTROL_OUTPUT_BYTES): Promise<DockerProcessResult> {
    const result = await this.processAdapter({ command: "docker", args: Object.freeze([...args]),
      env: env ?? Object.freeze({ PATH: this.contextEnvironment.PATH ?? "/usr/bin:/bin" }), stdin, timeoutMs, maxOutputBytes });
    if (result.transportUnsettled) this.transportUnsettled = true;
    return result;
  }
}

function parseCandidateResult(bytes: Buffer): string {
  const text = decode(bytes).trim();
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(parsed, "result")) throw new Error("Invalid candidate output contract");
  const result = (parsed as { result?: unknown }).result;
  scalarString(result, 4096, "candidate result");
  if (text !== JSON.stringify({ result })) throw new Error("Candidate output must be one canonical result object");
  return result;
}

function scalarString(value: unknown, maxBytes: number, name: string): asserts value is string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maxBytes || Buffer.from(value, "utf8").toString("utf8") !== value) {
    throw new Error(`${name} must be a bounded Unicode scalar string`);
  }
}
function boundedInteger(value: number, min: number, max: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} outside fixed limits`);
}
function localEndpoint(value: unknown): string {
  if (typeof value !== "string" || !/^unix:\/\/\/[A-Za-z0-9_./-]+$/.test(value) || value.length > 1024 || value.includes("/../")) {
    throw new Error("Only a local Unix-socket Docker endpoint is admitted");
  }
  return value;
}
function normalizeImage(value: string): string { return value.replace(/^(?:docker\.io\/|index\.docker\.io\/)/, "").replace(/^library\//, ""); }
function caseFeedback(test: PythonSandboxCase, run: DockerPythonCaseRun, maxBytes = 500): string {
  const feedback = { id: test.id, input: { text: test.text, byteLimit: test.byteLimit },
    actual: run.actual, expected: test.expected, error: run.error };
  // Preserve a valid data object even when strings contain escaped controls or
  // multibyte Unicode. Ellipses mark display shortening; raw evidence is separate.
  const fields = [
    { get: () => feedback.input.text, set: (value: string) => { feedback.input.text = value; } },
    { get: () => feedback.actual, set: (value: string) => { feedback.actual = value; } },
    { get: () => feedback.expected, set: (value: string) => { feedback.expected = value; } },
    { get: () => feedback.error, set: (value: string) => { feedback.error = value; } }
  ];
  let encoded = JSON.stringify(feedback);
  while (Buffer.byteLength(encoded, "utf8") > maxBytes) {
    const field = fields.filter(item => typeof item.get() === "string")
      .sort((a, b) => Buffer.byteLength(JSON.stringify(b.get()), "utf8") - Buffer.byteLength(JSON.stringify(a.get()), "utf8"))[0];
    const value = field.get()!;
    const size = Buffer.byteLength(JSON.stringify(value), "utf8");
    const target = Math.max(5, size - (Buffer.byteLength(encoded, "utf8") - maxBytes));
    field.set(shortenJSONString(value, target));
    encoded = JSON.stringify(feedback);
  }
  return encoded;
}
function hasProcessDiagnostic(run: DockerPythonCaseRun): boolean {
  return run.stderrBase64.length > 0 || run.exitCode !== 0 || run.signal !== null ||
    run.timedOut || run.outputLimitExceeded || run.transportUnsettled;
}
function diagnosticCaseFeedback(test: PythonSandboxCase, run: DockerPythonCaseRun): string {
  const stderr = run.stderr;
  const finalLine = stderr?.split(/\r?\n/).reverse().find(line => line.trim().length > 0);
  const stderrTail = stderr === null ? null : shortenJSONStringTail(stderr, 242);
  const fullDiagnostic = finalLine ?? (stderr === null ? "Captured stderr is not valid UTF-8" : run.error ?? "Candidate process failed");
  const diagnostic = shortenJSONString(fullDiagnostic, 122);
  const signal = run.signal === null ? null : shortenJSONString(run.signal, 34);
  // Keep the useful final diagnostic first, before case data. Candidate output is
  // untrusted even when it resembles a compiler traceback or an instruction.
  const details = {
    trust: "untrusted-candidate-output",
    diagnostic,
    diagnosticTruncated: diagnostic !== fullDiagnostic,
    stderrTail,
    stderrTruncated: stderr !== null && stderrTail !== stderr,
    stderrEncoding: stderr === null ? "invalid-utf8" : "utf8",
    captureTruncated: run.outputLimitExceeded,
    exitCode: run.exitCode,
    signal,
    signalTruncated: signal !== run.signal,
    timedOut: run.timedOut,
    outputLimitExceeded: run.outputLimitExceeded,
    transportUnsettled: run.transportUnsettled,
    caseTruncated: false
  };
  // The case encoder shortens only displayed strings; original inputs, outputs,
  // source identities and grading remain in the unchanged run record.
  const overhead = Buffer.byteLength(JSON.stringify({ ...details, case: null }), "utf8") - 4;
  const encodedCase = caseFeedback(test, run, Math.min(500, 1_000 - overhead));
  details.caseTruncated = encodedCase !== caseFeedback(test, run, Infinity);
  return JSON.stringify({ ...details, case: JSON.parse(encodedCase) });
}
function shortenJSONStringTail(value: string, maxEncodedBytes: number): string {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") <= maxEncodedBytes) return value;
  const characters = Array.from(value);
  let start = characters.length, used = 5; // JSON quotes and the leading ellipsis.
  while (start > 0) {
    const bytes = Buffer.byteLength(JSON.stringify(characters[start - 1]), "utf8") - 2;
    if (used + bytes > maxEncodedBytes) break;
    used += bytes;
    start -= 1;
  }
  return "…" + characters.slice(start).join("");
}
function shortenJSONString(value: string, maxEncodedBytes: number): string {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") <= maxEncodedBytes) return value;
  let out = "", used = 5; // JSON quotes plus the three UTF8 bytes of the ellipsis.
  for (const character of value) {
    const bytes = Buffer.byteLength(JSON.stringify(character), "utf8") - 2;
    if (used + bytes > maxEncodedBytes) break;
    out += character;
    used += bytes;
  }
  return out + "…";
}
function boundedUTF8(value: string, maxBytes: number): string {
  let out = "", used = 0;
  for (const character of value) {
    const bytes = Buffer.byteLength(character, "utf8");
    if (used + bytes > maxBytes) break;
    out += character;
    used += bytes;
  }
  return out;
}
function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function decode(value: Buffer): string { return new TextDecoder("utf-8", { fatal: true }).decode(value); }
function tryDecode(value?: Buffer): string | null { try { return value ? decode(value) : ""; } catch { return null; } }
function boundedError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 512); }
function requireSuccess(result: DockerProcessResult, label: string): void {
  if (result.transportUnsettled || result.spawnError || result.timedOut || result.outputLimitExceeded || result.exitCode !== 0 || result.signal) {
    throw new Error(`${label} failed${result.spawnError ? `: ${result.spawnError.slice(0, 200)}` : result.timedOut ? ": timeout" : result.outputLimitExceeded ? ": output limit" : `: exit ${result.exitCode}`}`);
  }
}
function parseSuccessfulJSON(result: DockerProcessResult, label: string): any {
  requireSuccess(result, label);
  return JSON.parse(decode(result.stdout));
}
async function privateDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "pocket-tool-sandbox-"));
  await chmod(path, 0o700);
  if (path.includes(",")) { await rm(path, { recursive: true, force: true }); throw new Error("Unsafe temporary directory for Docker mount"); }
  return path;
}

/** Bounded Docker CLI transport. Shell interpretation and local Python fallback are absent. */
async function runDockerProcess(request: DockerProcessRequest): Promise<DockerProcessResult> {
  return runBoundedDockerProcess(request, input => spawn(input.command, [...input.args],
    { env: { ...input.env }, stdio: ["pipe", "pipe", "pipe"], shell: false }));
}

/** Test-only transport seam. Supply through testProcessAdapter so evidence stays labelled. */
export function createDockerProcessAdapterForTests(
  spawnFixture: (request: DockerProcessRequest) => ChildProcessWithoutNullStreams
): DockerProcessAdapter {
  return request => runBoundedDockerProcess(request, spawnFixture);
}

async function runBoundedDockerProcess(request: DockerProcessRequest,
  spawnProcess: (request: DockerProcessRequest) => ChildProcessWithoutNullStreams): Promise<DockerProcessResult> {
  const started = Date.now();
  return new Promise(resolve => {
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let bytes = 0, timedOut = false, outputLimitExceeded = false, spawnError: string | undefined;
    let settled = false, killRequested = false;
    const child = spawnProcess(request);
    const ignoreLateError = (): void => {};
    const detachPipes = (): void => {
      child.stdout.removeListener("data", onStdout);
      child.stderr.removeListener("data", onStderr);
      child.stdout.on("error", ignoreLateError);
      child.stderr.on("error", ignoreLateError);
      child.stdout.destroy();
      child.stderr.destroy();
      child.stdin.destroy();
    };
    const finish = (exitCode: number | null, signal: string | null, transportUnsettled = false): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killDeadline);
      if (transportUnsettled) {
        child.removeListener("close", onClose);
        child.removeListener("error", onError);
        child.on("error", ignoreLateError);
        detachPipes();
        child.unref();
      }
      resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode, signal,
        timedOut, outputLimitExceeded, durationMs: Date.now() - started, spawnError, transportUnsettled, killRequested });
    };
    let killDeadline: ReturnType<typeof setTimeout> | undefined;
    const stop = (): void => {
      if (killRequested) return;
      killRequested = true;
      killDeadline = setTimeout(() => {
        spawnError = "Docker CLI did not close after termination was requested; settlement is unknown";
        // A requested SIGKILL is not an observed signal or process exit.
        finish(null, null, true);
      }, 1_000);
      child.kill("SIGKILL");
    };
    const capture = (target: Buffer[], chunk: Buffer): void => {
      if (settled) return;
      const remaining = Math.max(0, request.maxOutputBytes - bytes);
      if (remaining) target.push(Buffer.from(chunk.subarray(0, remaining)));
      bytes += chunk.length;
      if (bytes > request.maxOutputBytes) { outputLimitExceeded = true; stop(); }
    };
    const onStdout = (chunk: Buffer): void => capture(stdout, chunk);
    const onStderr = (chunk: Buffer): void => capture(stderr, chunk);
    const onError = (error: Error): void => { spawnError = boundedError(error); stop(); };
    const onClose = (code: number | null, signal: string | null): void => finish(code, signal);
    const timer = setTimeout(() => { timedOut = true; stop(); }, request.timeoutMs);
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("error", onError);
    child.on("close", onClose);
    child.stdin.on("error", () => { /* A closed input is reflected in process exit/output. */ });
    child.stdin.end(request.stdin ?? "");
  });
}
