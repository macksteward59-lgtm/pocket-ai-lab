"""Real local tiny Llama fixtures for training, HTTP and browser acceptance."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import worker


def make_fixtures(root):
    import torch
    from safetensors.torch import save_file
    from tokenizers import Tokenizer
    from tokenizers.models import WordLevel
    from tokenizers.pre_tokenizers import Whitespace
    from transformers import LlamaConfig, LlamaForCausalLM, PreTrainedTokenizerFast
    root.mkdir(exist_ok=True, parents=True)
    if any(root.iterdir()):
        raise ValueError("Choose an empty fixture directory.")
    worker.dependencies()
    # Vocabulary and training never use the held-out place names. Unknown words remain tokens.
    words = ["<pad>", "<eos>", "<unk>", "Record", "The", "gate", "is", ".", "Question", ":", "Is",
             "this", "?", "open", "closed", "Answer", "yes", "no"] + [row[0] for row in worker.TRAIN]
    vocab = {v: k for k, v in enumerate(words)}
    fast = Tokenizer(WordLevel(vocab=vocab, unk_token="<unk>"))
    fast.pre_tokenizer = Whitespace()
    tokenizer = PreTrainedTokenizerFast(tokenizer_object=fast, eos_token="<eos>", pad_token="<pad>", unk_token="<unk>")
    tokenizer.model_input_names = ["input_ids", "attention_mask"]
    config = LlamaConfig(vocab_size=len(vocab), hidden_size=32, intermediate_size=64, num_hidden_layers=2,
                         num_attention_heads=4, num_key_value_heads=2, max_position_embeddings=128,
                         tie_word_embeddings=False, eos_token_id=1, pad_token_id=0, bos_token_id=None,
                         attn_implementation="eager")
    def save(net, name):
        path = root / "imports" / name
        path.mkdir(parents=True)
        config.to_json_file(path / "config.json", use_diff=False)
        fast.save(str(path / "tokenizer.json"))
        save_file(net.state_dict(), str(path / "model.safetensors"), metadata={"format": "pt"})

    # The initial checkpoint learns to end a short response. Continue the teacher on both classes.
    net = LlamaForCausalLM(config)
    opt = torch.optim.AdamW(net.parameters(), lr=.006)
    for step in range(70):
        rows = [worker.TRAIN[step % len(worker.TRAIN)], worker.TRAIN[(step + 1) % len(worker.TRAIN)]]
        seqs = []
        for row in rows:
            question = tokenizer.encode(worker.prompt(row)) + [vocab["yes" if step < 8 or row[2] else "no"], vocab["<eos>"]]
            seqs.append(question)
        ids = torch.tensor(seqs)
        labels = ids.clone()
        labels[:, :-2] = -100
        loss = net(ids, labels=labels).loss
        loss.backward()
        opt.step()
        opt.zero_grad(set_to_none=True)
        if step == 7:
            save(net, "Fixture base")
    save(net, "Fixture teacher")


class WorkerTests(unittest.TestCase):
    def test_real_distillation_and_candidate_reuse(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"POCKET_TRAINING_DIR": directory}):
            root = Path(directory)
            make_fixtures(root)
            records = {m["name"]: m for m in worker.run({"op": "list"})["models"]}
            base, teacher = records["Fixture base"], records["Fixture teacher"]
            build = {"op": "build", "name": "First student", "base": base["id"], "teacher": teacher["id"]}
            first = worker.run(build)
            self.assertEqual(first["verifiedExamples"], len(worker.TRAIN))
            self.assertEqual(first["scores"]["teacher"], {"correct": 4, "total": 4})
            student = first["candidate"]
            self.assertNotIn(student["weightsSHA256"], [base["weightsSHA256"], teacher["weightsSHA256"]])
            self.assertEqual(student["parents"], {"base": base["id"], "teacher": teacher["id"]})
            self.assertEqual(worker.run(build), first)
            # Inspect reloaded tensors. Serialization alone must not count as a weight change.
            import torch
            from safetensors.torch import load_file
            query_weight = "model.layers.0.self_attn.q_proj.weight"
            old = load_file(str(root / "imports" / "Fixture base" / "model.safetensors"))
            new = load_file(str(root / "candidates" / student["id"] / "model.safetensors"))
            self.assertFalse(torch.equal(old[query_weight], new[query_weight]))
            got = worker.run({"op":"answer", "model":student["id"], "question":worker.prompt(worker.HOLDOUT[0])})
            self.assertEqual(got["model"], student["id"])
            self.assertTrue(got["answer"])
            second = worker.run({**build, "base":student["id"], "name":"Second student"})
            self.assertEqual(second["candidate"]["parents"]["base"], student["id"])
            catalog = {m["id"]: m for m in worker.run({"op":"list"})["models"]}
            self.assertEqual(catalog[base["id"]], base)
            self.assertEqual(catalog[teacher["id"]], teacher)
            self.assertEqual(len(catalog), 4)
            with self.assertRaisesRegex(worker.Invalid, "confident"):
                worker.run({**build, "base":teacher["id"], "teacher":base["id"]})
            with self.assertRaisesRegex(worker.Invalid, "different weights"):
                worker.run({**build, "base":teacher["id"]})
            with self.assertRaisesRegex(worker.Invalid, "unavailable"):
                worker.run({**build, "teacher":"../outside"})
            reply = subprocess.run([sys.executable, str(Path(worker.__file__))],
                                   input=json.dumps({"op":"list"}), text=True, capture_output=True, check=True)
            self.assertEqual(len(json.loads(reply.stdout)["models"]), 4)
            manifest = root / "candidates" / student["id"] / "workshop.json"
            original = manifest.read_bytes()
            altered = json.loads(original)
            altered["candidate"]["parents"]["base"] = teacher["id"]
            manifest.write_text(json.dumps(altered))
            self.assertNotIn(student["id"], [m["id"] for m in worker.run({"op":"list"})["models"]])
            manifest.write_bytes(original)
            # Simulate a partially overwritten checkpoint. Corrupt data never becomes a new parent.
            (root / "candidates" / student["id"] / "tokenizer.json").write_text("{}")
            self.assertNotIn(student["id"], [m["id"] for m in worker.run({"op":"list"})["models"]])
            print(json.dumps({"actualTeacherStudent": first["scores"], "verified": first["verifiedExamples"]}))

    def test_catalog_counts_only_unique_valid_snapshots_toward_capacity(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"POCKET_TRAINING_DIR": directory}):
            imports = Path(directory) / "imports"
            config = json.dumps(dict(model_type="llama", num_hidden_layers=2, hidden_size=32,
                                     num_attention_heads=4, intermediate_size=64, vocab_size=32,
                                     max_position_embeddings=128, eos_token_id=1))

            def add_snapshot(name, fixture_weights):
                # Catalog validation checks the config and hashes file bytes; it does not load tensors.
                path = imports / name
                path.mkdir(parents=True)
                (path / "config.json").write_text(config)
                (path / "tokenizer.json").write_text("{}")
                (path / "model.safetensors").write_text(fixture_weights)

            for index in range(128):
                add_snapshot(f"Model {index:03}", f"snapshot {index}")
            request = {"op": "list"}
            full = worker.run(request)
            models = full["models"]
            self.assertEqual(len({m["id"] for m in models}), 128)
            self.assertEqual(models[0]["name"], "Model 000")

            (imports / "ZZ incomplete").mkdir()
            with self.subTest(extra="incomplete import"):
                self.assertEqual(worker.run(request), full)
            (imports / "ZZ incomplete").rmdir()

            add_snapshot("ZZ duplicate", "snapshot 0")
            with self.subTest(extra="duplicate ID"):
                self.assertEqual(worker.run(request), full)

            add_snapshot("ZZ unique", "snapshot 128")
            with self.subTest(extra="129th unique ID"):
                with self.assertRaisesRegex(worker.Invalid, "exceeds its 128-model limit"):
                    worker.run(request)

    def test_missing_workspace_and_non_files(self):
        with patch.dict(os.environ, {"POCKET_TRAINING_DIR": ""}):
            with self.assertRaisesRegex(worker.Invalid, "Configure"):
                worker.run({"op": "list"})
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"POCKET_TRAINING_DIR": directory}):
            path = Path(directory) / "imports" / "incomplete"
            path.mkdir(parents=True)
            (path / "config.json").symlink_to(Path(worker.__file__))
            self.assertEqual(worker.run({"op":"list"}), {"models":[]})


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--make-fixtures":
        make_fixtures(Path(sys.argv[2]))
    else:
        unittest.main()
