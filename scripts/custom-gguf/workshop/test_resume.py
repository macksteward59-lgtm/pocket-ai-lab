"""Compare every stored tensor across fresh, interrupted CPU training processes."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from test_worker import make_fixtures


HERE = Path(__file__).resolve().parent
WORKER = HERE / "worker.py"


def invoke(root, body, *, crash=False):
    command = [sys.executable, str(Path(__file__).resolve()), "--crash-after-save"] if crash else [sys.executable, str(WORKER)]
    return subprocess.run(
        command, input=json.dumps(body), capture_output=True, text=True, timeout=120,
        env={**os.environ, "POCKET_TRAINING_DIR": str(root), "PYTHONDONTWRITEBYTECODE": "1"},
    )


def run_worker(root, body, *, expect_error=False):
    reply = invoke(root, body)
    if reply.returncode:
        raise AssertionError(f"Worker failed ({reply.returncode}): {reply.stderr[-1000:]}")
    value = json.loads(reply.stdout)
    if ("error" in value) != expect_error:
        raise AssertionError(f"Unexpected worker reply for {body['op']}: {value}")
    return value


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def parents(root):
    imports = root / "imports"
    return {str(file.relative_to(imports)): digest(file) for file in sorted(imports.rglob("*")) if file.is_file()}


def same_bits(tensor, other):
    import torch
    return (tensor.shape == other.shape and tensor.dtype == other.dtype and
            torch.equal(tensor.contiguous().view(torch.uint8), other.contiguous().view(torch.uint8)))


def kill_after_checkpoint():
    """Test-only observer. Kill after the genuine writer has published an intermediate checkpoint."""
    import worker

    writer = worker.checkpoint.save

    def persist_then_die(path, manifest, model, optimizer):
        result = writer(path, manifest, model, optimizer)
        if manifest["completedSteps"] == 16:
            os.kill(os.getpid(), signal.SIGKILL)
        return result

    worker.checkpoint.save = persist_then_die
    worker.main()


class ResumeTests(unittest.TestCase):
    def test_paused_run_reserves_the_last_candidate_slot(self):
        import worker
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"POCKET_TRAINING_DIR": directory}):
            root = Path(directory)
            make_fixtures(root)
            imports = root / "imports"
            template = imports / "Fixture base"
            raw_config = (template / "config.json").read_text()

            def add_import(index):
                folder = imports / f"Capacity fixture {index}"
                folder.mkdir()
                # Each valid snapshot has a distinct config-file digest. Hard links keep the
                # synthetic catalog small without changing the two actual training parents.
                (folder / "config.json").write_text(raw_config + " " * index)
                for name in ("tokenizer.json", "model.safetensors"):
                    os.link(template / name, folder / name)
                return folder

            records = {m["name"]: m["id"] for m in worker.run({"op": "list"})["models"]}
            build = {"op": "build", "base": records["Fixture base"], "teacher": records["Fixture teacher"],
                     "name": "Reserved student", "throughStep": 12}
            draft = worker.run(build)["draft"]
            checkpoint = root / "drafts" / (draft["id"] + ".safetensors")
            saved = digest(checkpoint)
            for index in range(1, 126):
                add_import(index)
            self.assertEqual(len(worker.run({"op": "list"})["models"]), 127)
            with self.assertRaises(worker.Invalid):
                worker.run({**build, "name": "Extra student"})
            self.assertEqual(worker.run({"op": "list"})["drafts"], [draft])
            extra = add_import(126)
            self.assertEqual(len(worker.run({"op": "list"})["models"]), 128)
            with self.assertRaises(worker.Invalid):
                worker.run({"op": "resume", "draft": draft["id"]})
            self.assertEqual(digest(checkpoint), saved)
            self.assertFalse((root / "candidates" / draft["id"]).exists())
            shutil.rmtree(extra)
            final = worker.run({"op": "resume", "draft": draft["id"]})
            self.assertEqual(final["candidate"]["id"], draft["id"])
            catalog = worker.run({"op": "list"})
            self.assertEqual(len(catalog["models"]), 128)
            self.assertFalse(catalog.get("drafts"))

    def test_lora_adamw_resume_matches_every_uninterrupted_tensor(self):
        from safetensors.torch import load_file

        with tempfile.TemporaryDirectory() as directory:
            direct, split = Path(directory) / "direct", Path(directory) / "split"
            make_fixtures(direct)
            shutil.copytree(direct / "imports", split / "imports")
            original_parents = parents(direct)
            imports = run_worker(direct, {"op": "list"})["models"]
            records = {model["name"]: model["id"] for model in imports}
            build = {"op": "build", "base": records["Fixture base"], "teacher": records["Fixture teacher"],
                     "name": "Resume comparison"}
            baseline = run_worker(direct, build)
            paused = run_worker(split, {**build, "throughStep": 12})["draft"]
            self.assertEqual((paused["completedSteps"], paused["totalSteps"]), (12, 24))
            self.assertEqual(paused["parents"], {"base": build["base"], "teacher": build["teacher"]})
            ident = paused["id"]
            self.assertEqual(ident, baseline["candidate"]["id"])
            resume = {"op": "resume", "draft": ident}
            checkpoint = split / "drafts" / (ident + ".safetensors")
            at_twelve = checkpoint.read_bytes()
            state = load_file(str(checkpoint))
            adapters = {key.removeprefix("adapter/") for key in state if key.startswith("adapter/")}
            self.assertTrue(adapters)
            self.assertGreater(state["cpu_rng"].numel(), 0)
            for prefix in ("step/", "exp_avg/", "exp_avg_sq/"):
                self.assertEqual({key.removeprefix(prefix) for key in state if key.startswith(prefix)}, adapters)
            self.assertTrue(all(state["step/" + key].item() == 12 for key in adapters))
            self.assertTrue(any(state["exp_avg_sq/" + key].count_nonzero().item() for key in adapters))
            self.assertEqual(run_worker(split, {**resume, "throughStep": 12})["draft"], paused)
            self.assertEqual(checkpoint.read_bytes(), at_twelve)

            # Keep the safetensors header parseable while corrupting payload bytes. The
            # worker must reject the altered state even when its ID, name and parents still match.
            checkpoint.write_bytes(at_twelve[:-1] + bytes([at_twelve[-1] ^ 1]))
            self.assertRegex(run_worker(split, resume, expect_error=True)["error"], "(?i)(integrity|checkpoint|corrupt)")
            self.assertFalse((split / "candidates" / ident).exists())
            self.assertEqual(parents(split), original_parents)
            checkpoint.write_bytes(at_twelve)

            crashed = invoke(split, resume, crash=True)
            self.assertEqual(crashed.returncode, -signal.SIGKILL, crashed.stderr[-1000:])
            after_crash = run_worker(split, {"op": "list"})
            self.assertEqual(after_crash["models"], imports)
            self.assertEqual(len(after_crash["drafts"]), 1)
            surviving = after_crash["drafts"][0]
            self.assertEqual(surviving["id"], ident)
            self.assertEqual(surviving["completedSteps"], 16)
            self.assertEqual(run_worker(split, {**resume, "throughStep": 12})["draft"], surviving)

            finished = run_worker(split, resume)
            self.assertEqual(finished["steps"], baseline["steps"])
            self.assertEqual(finished["steps"], 24)
            self.assertEqual(finished["scores"], baseline["scores"])
            self.assertEqual(finished["verifiedExamples"], baseline["verifiedExamples"])
            self.assertEqual(finished["candidate"]["id"], ident)
            self.assertEqual(run_worker(split, resume), finished)
            self.assertEqual(run_worker(split, build), finished)
            final_catalog = run_worker(split, {"op": "list"})
            self.assertFalse(final_catalog.get("drafts"))
            self.assertEqual([m["id"] for m in final_catalog["models"] if m["kind"] == "candidate"], [ident])
            self.assertEqual(parents(direct), original_parents)
            self.assertEqual(parents(split), original_parents)

            def weights(root):
                return load_file(str(root / "candidates" / ident / "model.safetensors"))

            expected, actual = weights(direct), weights(split)
            base = load_file(str(direct / "imports" / "Fixture base" / "model.safetensors"))
            self.assertEqual(set(expected), set(actual))
            self.assertEqual(set(base), set(actual))
            changed = []
            total_parameters = 0
            for key in sorted(actual):
                self.assertTrue(same_bits(expected[key], actual[key]), f"Different tensor bits at {key}")
                total_parameters += actual[key].numel()
                if not same_bits(base[key], actual[key]):
                    changed.append(key)
            self.assertTrue(any("q_proj" in key for key in changed), changed)
            self.assertTrue(any("v_proj" in key for key in changed), changed)
            print(json.dumps({
                "pauseStep": 12, "stepRecoveredAfterSIGKILL": surviving["completedSteps"],
                "finishedSteps": finished["steps"], "equalTensors": len(actual),
                "comparedParameters": total_parameters, "changedFromBase": changed,
                "runtimeVersions": finished["runtimeVersions"], "trainingDataSHA256": finished["trainingSHA256"],
                "checkpointedAdapterTensors": len(adapters), "corruptionRejected": True,
                "unchangedParentFiles": len(original_parents),
            }))


if __name__ == "__main__":
    if sys.argv[1:] == ["--crash-after-save"]:
        kill_after_checkpoint()
    else:
        unittest.main()
