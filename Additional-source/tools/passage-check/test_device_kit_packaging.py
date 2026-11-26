"""Publication tests for the device kit; Xcode is replaced by a controlled stub."""
import hashlib
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("package-device-kit.sh").resolve()
ARCHIVE = "pocket-ai-lab-device-kit.tar.gz"
CHECKSUM = "pocket-ai-lab-device-kit.sha256"
PASSAGES = "ios/PocketAILab/PassageChecks.json"
REGISTER = "docs/research/project-sources.json"

XCODE_STUB = """#!/usr/bin/env bash
set -euo pipefail
case "$STUB_MODE" in
  rebuild-fails) exit 75 ;;
esac
while [[ $# -gt 0 ]]; do
  if [[ "$1" == -derivedDataPath ]]; then
    derived=$2
    break
  fi
  shift
done
app="$derived/Build/Products/Debug-iphoneos/PocketAILab.app"
mkdir -p "$app"
cp ios/PocketAILab/PassageChecks.json "$app/"
cp docs/research/project-sources.json "$app/"
case "$STUB_MODE" in
  bad-passage) printf 'changed' > "$app/PassageChecks.json" ;;
  bad-register) printf 'changed' > "$app/project-sources.json" ;;
esac
"""


class DeviceKitPackagingTests(unittest.TestCase):
    def setUp(self):
        storage = tempfile.TemporaryDirectory()
        self.addCleanup(storage.cleanup)
        root = Path(storage.name)
        self.repo = root / "source"
        self.repo.mkdir()
        self.destination = root / "destination"
        self.destination.mkdir()
        self.bin = root / "bin"
        self.bin.mkdir()
        stub = self.bin / "xcodebuild"
        stub.write_text(XCODE_STUB, encoding="utf-8")
        stub.chmod(0o755)
        self.git("init", "-q")
        self.git("-c", "user.name=Kit Test", "-c", "user.email=kit@example.invalid",
                 "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "Kit fixture")
        for entry in ("ios/PocketAILabTests", "ios/PocketAILabUITests", "ios/PocketAILab.xcodeproj",
                      "runtime/ios/Sources", "runtime/ios/Tests", "runtime/ios/build/xc", "runtime/ios/pin"):
            (self.repo / entry).mkdir(parents=True)
        for entry in (PASSAGES, REGISTER, "ios/PRIVATE-IPHONE-TESTING.md", "runtime/ios/Package.swift",
                      "tools/evaluation-review/verify.py", "tools/evaluation-review/source_run.py",
                      "tools/evaluation-review/source_review.py", "tools/evaluation-review/hosted-passage-reference.json",
                      "runtime/ios/build/src/llama.cpp-fixture/LICENSE"):
            path = self.repo / entry
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(entry + "\n", encoding="utf-8")

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True, text=True).stdout.strip()

    def package(self, mode):
        env = {**os.environ, "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}", "STUB_MODE": mode}
        return subprocess.run(["bash", str(SCRIPT), str(self.destination)], env=env, cwd=self.repo,
                              capture_output=True, text=True, timeout=15)

    def test_rebuild_failure_publishes_nothing(self):
        result = self.package("rebuild-fails")
        self.assertEqual(result.returncode, 75, result.stderr)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_failed_rebuild_and_each_failed_comparison_preserve_last_pair(self):
        for name in (ARCHIVE, CHECKSUM):
            (self.destination / name).write_bytes(name.encode("ascii"))
        for mode in ("rebuild-fails", "bad-passage", "bad-register"):
            with self.subTest(mode=mode):
                result = self.package(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(sorted(p.name for p in self.destination.iterdir()), sorted((ARCHIVE, CHECKSUM)))
                for name in (ARCHIVE, CHECKSUM):
                    self.assertEqual((self.destination / name).read_bytes(), name.encode("ascii"))

    def test_success_publishes_named_archive_and_relative_checksum(self):
        result = self.package("success")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(p.name for p in self.destination.iterdir()), sorted((ARCHIVE, CHECKSUM)))
        archive_path = self.destination / ARCHIVE
        checksum_path = self.destination / CHECKSUM
        self.assertEqual(checksum_path.read_text(encoding="utf-8").split(),
                         [hashlib.sha256(archive_path.read_bytes()).hexdigest(), ARCHIVE])
        with tarfile.open(archive_path, "r:gz") as archive:
            for entry in (PASSAGES, REGISTER):
                self.assertEqual(archive.extractfile(f"PocketAILab/{entry}").read(), (self.repo / entry).read_bytes())
            self.assertEqual(archive.extractfile("PocketAILab/SOURCE-COMMIT.txt").read().decode().strip(),
                             self.git("rev-parse", "HEAD"))
