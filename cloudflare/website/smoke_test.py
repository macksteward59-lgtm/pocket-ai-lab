"""Exercise the public website with Wrangler's local Workers runtime."""
from contextlib import contextmanager
from http.client import HTTPConnection, HTTPException
from pathlib import Path
import os
import signal
import socket
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parent
PUBLIC_PATHS = ("/", "/styles.css", "/hosted.js", "/manifest.webmanifest", "/icon.svg")
PRIVATE_PATHS = ("/app.js", "/sw.js", "/api/memory", "/server.mjs",
                "/memoryRuntime.ts", "/.env", "/mcp")


def request(port, method, path):
    connection = HTTPConnection("127.0.0.1", port, timeout=3)
    try:
        connection.request(method, path)
        response = connection.getresponse()
        return response.status, response.headers, response.read()
    finally:
        connection.close()


@contextmanager
def local_server():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    command = [ROOT / "node_modules/.bin/wrangler", "dev", "--local",
               "--ip", "127.0.0.1", "--port", str(port), "--inspector-port", "0"]
    with tempfile.TemporaryFile(mode="w+") as log:
        process = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=log,
                                   start_new_session=True,
                                   env={**os.environ, "CI": "1", "WRANGLER_SEND_METRICS": "false"})
        try:
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline and process.poll() is None:
                try:
                    request(port, "GET", "/")
                    break
                except (OSError, HTTPException):
                    time.sleep(0.2)
            else:
                log.seek(0)
                raise RuntimeError(f"Local Wrangler failed to start.\n{log.read()}")
            yield port
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()


def run_checks():
    with local_server() as port:
        routes = [("GET", path, (200,)) for path in PUBLIC_PATHS]
        routes.extend(("GET", path, (404,)) for path in PRIVATE_PATHS)
        routes.append(("POST", "/api/chat", (404, 405)))
        for method, path, allowed in routes:
            status, headers, body = request(port, method, path)
            if status not in allowed:
                raise AssertionError(f"{method} {path} returned {status}, expected {allowed}")
            if path == "/":
                if b"Web preview" not in body or b"<form" in body or b"<textarea" in body:
                    raise AssertionError("The public homepage must identify the preview and omit input forms")
                if "connect-src 'none'" not in headers.get("Content-Security-Policy", ""):
                    raise AssertionError("The public homepage must block browser connections")
            print(f"{method} {path} {status}")


if __name__ == "__main__":
    run_checks()
