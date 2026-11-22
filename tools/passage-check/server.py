"""Run the iPhone passage suite on a private llama.cpp HTTP server and retain every reply."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/openclaw-review"))
from review import MODEL, MODEL_SHA256, wait_for_model
from extractive import passage_grammar

SUITE = ROOT / "ios/PocketAILab/PassageChecks.json"


def run(gguf, executable, output, *, suite_path=SUITE, grammar=None, extractive=False):
    with gguf.open("rb") as model:
        if hashlib.file_digest(model, "sha256").hexdigest() != MODEL_SHA256:
            raise ValueError("Model differs from the pinned Qwen artifact")
    executable = executable.resolve(strict=True)
    suite_bytes = suite_path.read_bytes()
    suite = json.loads(suite_bytes)
    result = dict(suiteID=suite["suiteID"], suiteVersion=suite["version"],
                  suiteSHA256=hashlib.sha256(suite_bytes).hexdigest(), model=MODEL,
                  modelSHA256=MODEL_SHA256, host=platform.system() + "/" + platform.machine(),
                  runtimeVersion=subprocess.check_output([executable, "--version"], stderr=subprocess.STDOUT, text=True).strip(),
                  provider="llama.cpp /v1/chat/completions", cases=[])
    if grammar is not None and extractive:
        raise ValueError("Choose one decoding constraint")
    result["generationFormat"] = "unrestricted" if grammar is None else "citation-grammar"
    if extractive:
        result["generationFormat"] = "quoted-span"
    if grammar is not None:
        result["grammarSHA256"] = hashlib.sha256(grammar.encode()).hexdigest()
    # Reserve a new destination once. Each checkpoint replaces only this run's file.
    with output.open("x", encoding="utf-8") as initial:
        json.dump(result, initial)
    def save():
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent, delete=False) as stage:
            stage.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        os.replace(stage.name, output)

    with tempfile.TemporaryDirectory() as temp:
        key = secrets.token_urlsafe(32)
        key_file = Path(temp) / "server.key"
        key_file.write_text(key)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        cmd = [executable, "--model", gguf.resolve(), "--alias", MODEL, "--host", "127.0.0.1",
               "--port", str(port), "--api-key-file", key_file, "--ctx-size", "2048",
               "--threads", "4", "--parallel", "1", "-ngl", "0", "--no-warmup"]
        server = subprocess.Popen(cmd, stdout=sys.stderr, stderr=sys.stderr)
        try:
            wait_for_model(server, port, key)
            client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            for case in suite["cases"]:
                body = dict(model=MODEL, messages=[{"role":"user","content":case["prompt"]}],
                            temperature=0, seed=17, max_tokens=suite["maxTokens"], stream=False)
                constraint = passage_grammar(case["prompt"]) if extractive else grammar
                if constraint is not None:
                    body["grammar"] = constraint
                request = urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions",
                    data=json.dumps(body).encode(), headers={"Content-Type":"application/json","Authorization":"Bearer " + key})
                start = time.monotonic()
                row = dict(caseID=case["id"], promptSHA256=hashlib.sha256(case["prompt"].encode()).hexdigest(),
                           expected=case["expected"], passed=False)
                if constraint is not None:
                    row["grammarSHA256"] = hashlib.sha256(constraint.encode()).hexdigest()
                try:
                    with client.open(request, timeout=90) as response:
                        reply = json.load(response)
                    choice = reply["choices"][0]
                    actual = choice["message"]["content"]
                    if reply["model"] != MODEL or not isinstance(actual, str):
                        raise ValueError("Unexpected reply identity or content")
                    row.update(output=actual, requestID=reply["id"], finishReason=choice["finish_reason"],
                               completionTokens=reply["usage"]["completion_tokens"],
                               passed=choice["finish_reason"] == "stop" and actual == case["expected"])
                except (OSError, ValueError, TypeError, IndexError, KeyError) as error:
                    row["error"] = str(error)
                row["latencyMs"] = round(1000 * (time.monotonic() - start))
                result["cases"].append(row)
                save()
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
    result["passed"] = sum(row["passed"] for row in result["cases"])
    result["total"] = len(suite["cases"])
    result["allPassed"] = result["passed"] == result["total"]
    save()
    print(f"Exact answers: {result['passed']}/{result['total']}")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ["--gguf", "--llama-server", "--output"]:
        parser.add_argument(argument, type=Path, required=True)
    args = parser.parse_args()
    run(args.gguf, args.llama_server, args.output)
