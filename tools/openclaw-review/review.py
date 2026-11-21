"""Run the PR #245 evidence review with OpenClaw and a local llama.cpp model."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request

MODEL = "qwen2.5-1.5b-instruct-q4_k_m"
MODEL_SHA256 = "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e"
EVIDENCE = Path(__file__).with_name("pr-245.txt")
# The model writes the summaries and selects an uncertainty listed in the evidence.
REVIEW_GRAMMAR = r'''root ::= "Hosted CI job " [0-9]{1,18} ": " line "\nLocal checks: " line "\nUnverified: " limit
line ::= [^.\n\r]{4,170} "."
limit ::= "Live model inference." | "Remaining Workers AI allowance." | "Deployment to production." | "Execution on a physical iPhone."
'''


def model_config(port, key):
    provider = {
        "baseUrl": f"http://127.0.0.1:{port}/v1",
        "api": "openai-completions",
        "apiKey": key,
        "agentRuntime": {"id": "openclaw"},
        "models": [{"id": MODEL, "name": MODEL, "contextWindow": 32768, "maxTokens": 384,
                    "compat": {"supportsTools": False}}],
    }
    defaults = {
        "contextInjection": "never",
        "params": {"temperature": 0, "extra_body": {"grammar": REVIEW_GRAMMAR}},
        "model": {"primary": f"pocket-local/{MODEL}", "fallbacks": []},
    }
    return {
        "models": {"mode": "replace", "providers": {"pocket-local": provider}},
        "agents": {"defaults": defaults},
        "tools": {"profile": "minimal", "deny": ["*"]},
        "skills": {"allowBundled": []},
        "plugins": {"slots": {"memory": "none"}, "deny": ["memory-core"]},
    }


def wait_for_model(server, port, key):
    request = urllib.request.Request(f"http://127.0.0.1:{port}/v1/models",
                                     headers={"Authorization": f"Bearer {key}"})
    local_http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(90):
        if server.poll() is not None:
            raise RuntimeError(f"llama-server exited during startup ({server.returncode})")
        try:
            with local_http.open(request, timeout=1) as response:
                if MODEL in [row["id"] for row in json.load(response)["data"]]:
                    return
        except OSError:
            pass
        time.sleep(1)
    raise TimeoutError("Local model did not become ready")


def review(args):
    with args.gguf.open("rb") as model:
        if hashlib.file_digest(model, "sha256").hexdigest() != MODEL_SHA256:
            raise ValueError("Expected the pinned Qwen2.5 1.5B Instruct Q4_K_M model")
    openclaw = shutil.which(args.openclaw)
    llama = shutil.which(args.llama_server)
    if not openclaw or not llama:
        raise ValueError("Provide the installed openclaw and llama-server executables")
    openclaw = str(Path(openclaw).resolve())
    llama = str(Path(llama).resolve())
    with tempfile.TemporaryDirectory(prefix="pocket-openclaw-") as directory:
        root = Path(directory)
        workspace = root / "workspace"
        workspace.mkdir()
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        key = secrets.token_urlsafe(32)
        key_file = root / "local.key"
        key_file.write_text(key)
        config = root / "openclaw.json"
        config.write_text(json.dumps(model_config(port, key)))
        env = {"PATH": os.environ["PATH"], "OPENCLAW_HOME": directory,
               "OPENCLAW_STATE_DIR": str(root / "state"), "TMPDIR": directory,
               "NO_PROXY": "127.0.0.1,localhost", "TERM": "dumb"}
        cmd = [llama, "--model", str(args.gguf.resolve()), "--alias", MODEL, "--host",
               "127.0.0.1", "--port", str(port), "--ctx-size", "32768", "--parallel", "1",
               "--threads", "4", "--seed", "245", "--temp", "0", "--no-ui", "--api-key-file", str(key_file)]
        with (root / "server.log").open("w") as log:
            server = subprocess.Popen(cmd, env=env, stdout=log, stderr=log)
            try:
                wait_for_model(server, port, key)
                record = EVIDENCE.read_text().partition("\nReview request:")[0]
                job = re.search(r"/job/(\d+)", record)
                counts = re.search(r"(\d+) provider, lifecycle and compatibility tests passed across (\d+) files", record)
                if job is None or counts is None:
                    raise ValueError("GitHub job ID or local test totals are missing from the evidence")
                job_id = job.group(1)
                test_count, file_count = counts.groups()
                hosted = next(line for line in record.splitlines() if line.startswith("The local-worker"))
                independent = next(line for line in record.splitlines() if line.startswith("ChatGPT independently"))
                facts = f"HOSTED JOB: {hosted.split('. ', 1)[0]}.\nINDEPENDENT LOCAL RUN: {independent}"
                prompt = (f"Draft a short test report from the following facts. Job ID: {job_id}. "
                          f"Independent local test count: {test_count}. Local test file count: {file_count}. "
                          f"Evidence: {facts}\n\nWrite three short lines of plain English, headed "
                          f"'Hosted CI job {job_id}:', 'Local checks:' and 'Unverified:'. Include the "
                          "local counts as digits. Write one complete sentence per line. Keep the first "
                          "two sentences under 20 words. Select one evidence limit for the third line.")
                result = subprocess.run([openclaw, "agent", "exec", "--config", str(config),
                    "--model", f"pocket-local/{MODEL}", "--cwd", str(workspace), "--message-file",
                    "-", "--code-mode", "direct", "--thinking", "off", "--timeout", "300", "--json"],
                    cwd=workspace, env=env, input=prompt, text=True, stdout=subprocess.PIPE,
                    timeout=360)
                receipt = json.loads(result.stdout)
                if result.returncode or not receipt.get("ok"):
                    raise RuntimeError(receipt.get("error", "OpenClaw did not finish the review"))
                if (receipt.get("provider") != "pocket-local" or receipt.get("model") != MODEL
                        or receipt.get("toolSummary", {}).get("calls", 0)
                        or not receipt.get("final", "").strip()):
                    raise ValueError("Unexpected model, tool activity or empty review")
                draft = receipt["final"]
                local_checks = draft.partition("\nLocal checks: ")[2].partition("\n")[0]
                figures_match = (
                    draft.startswith(f"Hosted CI job {job_id}: ")
                    and bool(re.search(rf"\b{test_count}\b", local_checks))
                    and bool(re.search(rf"\b{file_count}\b", local_checks))
                    and "\nUnverified: " in draft
                    and len(draft.splitlines()) == 3
                )
                report = {
                    "evidence_sha256": hashlib.sha256(EVIDENCE.read_bytes()).hexdigest(),
                    "model_sha256": MODEL_SHA256,
                    "source": {"job_id": job_id, "hosted_steps": hosted.split(". ", 1)[0] + ".",
                               "local_tests": int(test_count), "local_files": int(file_count)},
                    "review_status": "awaiting_source_review" if figures_match else "needs_correction",
                    "receipt": receipt,
                }
                if args.activity_record:
                    # Share the review without session IDs, provider internals or duplicate payloads.
                    report["receipt"] = {field: receipt[field] for field in
                                         ("ok", "model", "provider", "final")}
                    report["format"] = "pocket-ai-lab.ci-review.v1"
                print(json.dumps(report, indent=2))
            finally:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gguf", type=Path, required=True)
    parser.add_argument("--openclaw", default="openclaw")
    parser.add_argument("--llama-server", default="llama-server")
    parser.add_argument("--activity-record", action="store_true",
                        help="Export the compact owner-facing record for the Activity view")
    review(parser.parse_args())
