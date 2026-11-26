"""Exercise the dashboard's JSON format choice, local review and download in Chrome."""

import json
import shutil
import socket
import time
from pathlib import Path
from threading import Thread

import uvicorn

from playwright.sync_api import expect, sync_playwright


def check_dashboard(url):
    item = {"VulnerabilityID": "TEST-101", "PkgName": "demo", "InstalledVersion": "1",
            "FixedVersion": "2"}
    results = [
        {"Target": "a/lock", "Type": "npm", "Vulnerabilities": [item, item]},
        {"Target": "b/lock", "Type": "npm", "Vulnerabilities": [{**item, "FixedVersion": "3"}]},
    ]
    payload = json.dumps({"SchemaVersion": 2, "Results": results}).encode()
    with sync_playwright() as pw:
        chrome = shutil.which("google-chrome") or shutil.which("chromium")
        browser = pw.chromium.launch(executable_path=chrome)
        page = browser.new_page()
        external = []

        def local_only(route):
            if route.request.url.startswith((url + "/", "blob:")):
                route.continue_()
            else:
                external.append(route.request.url)
                route.abort()

        page.route("**/*", local_only)
        page.goto(url + "/dashboard/")
        page.locator("#upload").set_input_files(
            {"name": "artifact.json", "mimeType": "application/json", "buffer": payload}
        )
        expect(page.locator("#source-format")).to_have_value("trivy")
        for _ in range(2):
            with page.expect_response(lambda r: r.url.endswith("/dependencies/trivy")):
                page.get_by_role("button", name="Review locally").click()
            expect(page.locator("#result")).to_contain_text("findings in this report: 2")
            expect(page.locator("#result")).to_contain_text("a/lock")
            expect(page.locator("#result")).to_contain_text("b/lock")
        with page.expect_download() as downloaded:
            page.locator("#download-json").click()
        draft = json.loads(Path(downloaded.value.path()).read_text())
        assert [(f["target"], f["fixed_version"]) for f in draft["findings"]] == [
            ("a/lock", "2"), ("b/lock", "3")
        ]
        page.locator("#content").fill("{}")
        page.get_by_role("button", name="Review locally").click()
        expect(page.locator("#result")).to_contain_text("Expected a Trivy")
        expect(page.locator("#download-json")).to_be_disabled()
        page.locator("#upload").set_input_files(
            {"name": "zap.json", "mimeType": "application/json", "buffer": b'{"site":[]}'}
        )
        expect(page.locator("#source-format")).to_have_value("zap")
        assert not external, external
        print(f"Chrome {browser.version}: upload, repeat review, target-specific fixes, JSON export, "
              "invalid input and ZAP selection passed.")
        browser.close()


def main():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        url = f"http://127.0.0.1:{sock.getsockname()[1]}"
        server = uvicorn.Server(uvicorn.Config("ai_integrator.main:app"))
        thread = Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
        thread.start()
        try:
            for _ in range(100):
                if server.started:
                    break
                if not thread.is_alive():
                    raise RuntimeError("The sidecar exited before the dashboard was available")
                time.sleep(0.1)
            else:
                raise TimeoutError("The sidecar did not become ready")
            check_dashboard(url)
        finally:
            server.should_exit = True
            thread.join(timeout=10)


if __name__ == "__main__":
    main()
