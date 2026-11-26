"""Offline two-parent CPU LoRA worker. One bounded JSON request and reply per process."""
import contextlib
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys

import checkpoint

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from train import evaluate

RECIPE = "document-verification-lora-v1"
TOTAL_STEPS = 24
CHECKPOINT_INTERVAL = 4
LORA = dict(r=4, lora_alpha=8, target_modules=["q_proj", "v_proj"], lora_dropout=0.0, bias="none", task_type="CAUSAL_LM")
LEARNING_RATE = 0.003
FILES = {"config.json": 65536, "tokenizer.json": 16 << 20, "model.safetensors": 720 << 20}
# Independently keyed synthetic records. Accuracy is constrained yes/no next-token accuracy.
TRAIN = (("north", "open", True), ("west", "closed", False), ("east", "open", True),
         ("south", "closed", False), ("garden", "closed", False), ("ridge", "open", True))
HOLDOUT = (("alder", "closed", False), ("cedar", "open", True),
           ("birch", "open", True), ("maple", "closed", False))


class Invalid(ValueError):
    """A bounded, user-facing input or dependency error."""


def prompt(example):
    return f"Record: The {example[0]} gate is {example[1]}.\nQuestion: Is this gate open?\nAnswer:"


def hash_json(value):
    return hashlib.sha256(json.dumps(value, separators=(",", ":"), sort_keys=True).encode()).hexdigest()


def check_name(name):
    if not isinstance(name, str) or not 1 <= len(name) <= 64 or not name.strip() or not name.isprintable():
        raise Invalid("Choose a printable model name of 1 to 64 characters.")
    return name.strip()


def snapshot(directory, keep=False):
    """Read only regular, size-bounded files pinned to an opened snapshot directory."""
    chunks, hashes = {}, {}
    flags = os.O_RDONLY | os.O_NOFOLLOW
    dfd = os.open(directory, flags | os.O_DIRECTORY)
    try:
        for name, max_size in FILES.items():
            fd = os.open(name, flags | os.O_NONBLOCK, dir_fd=dfd)
            with os.fdopen(fd, "rb") as f:
                st = os.fstat(f.fileno())
                if not stat.S_ISREG(st.st_mode) or not 0 < st.st_size <= max_size:
                    raise Invalid("A snapshot file is missing, too large, or unsupported.")
                digest = hashlib.sha256()
                data = bytearray() if keep or name == "config.json" else None
                read = 0
                while part := f.read(1048576):
                    read += len(part)
                    if read > st.st_size:
                        raise Invalid("A snapshot changed while it was being read.")
                    digest.update(part)
                    if data is not None:
                        data.extend(part)
                if read != st.st_size:
                    raise Invalid("A snapshot changed while it was being read.")
                hashes[name] = digest.hexdigest()
                if name == "config.json":
                    validated_config(json.loads(data))
                if keep:
                    chunks[name] = bytes(data)
    finally:
        os.close(dfd)
    return hash_json(hashes), hashes["model.safetensors"], chunks


def parent_directory(root, name, create=False):
    path = root / name
    if create:
        path.mkdir(mode=0o700, exist_ok=True)
    if path.is_symlink() or not path.is_dir():
        raise Invalid("The configured training workspace is unavailable.")
    return path


def catalog(root):
    records = {}
    for group in ("imports", "candidates"):
        if not (root / group).exists():
            continue
        parent = parent_directory(root, group)
        for path in sorted(parent.iterdir()):
            if path.name.startswith(".") or path.is_symlink() or not path.is_dir():
                continue
            try:
                artifact, weights, _ = snapshot(path)
                if group == "imports":
                    name = check_name(path.name)
                    item = dict(id="import-" + artifact, name=name, kind="import")
                else:
                    if not re.fullmatch(r"candidate-[0-9a-f]{64}", path.name):
                        continue
                    report = load_report(path)
                    item = report["candidate"]
                    if (item["id"] != path.name or item["artifactSHA256"] != artifact or item["weightsSHA256"] != weights
                            or item["id"] != build_id(report["recipe"], report["runtimeVersions"], item["parents"], item["name"])):
                        continue
            except (OSError, KeyError, TypeError, ValueError):
                continue
            ident = item["id"]
            if ident in records:
                continue
            # Keep real overflow outside the invalid-snapshot handler (Invalid is a ValueError).
            if len(records) >= 128:
                raise Invalid("The local catalog exceeds its 128-model limit.")
            item.update(artifactSHA256=artifact, weightsSHA256=weights)
            records[ident] = (item, path)
    return records


def load_report(path):
    report = path / "workshop.json"
    if report.is_symlink() or not 0 < report.stat().st_size <= 16384:
        raise Invalid("The saved candidate record is invalid.")
    with report.open() as handle:
        return json.load(handle)


def dependencies():
    try:
        import torch
        import peft
        import transformers
        import safetensors
    except ImportError:
        raise Invalid("Install the local CPU workshop dependencies on the training host.") from None
    torch.set_num_threads(1)
    torch.manual_seed(4317)
    torch.use_deterministic_algorithms(True)
    return [torch.__version__, transformers.__version__, peft.__version__, safetensors.__version__]


def validated_config(raw):
    if not isinstance(raw, dict) or raw.get("model_type") != "llama":
        raise Invalid("This trainer supports dense Llama-family safetensors snapshots.")
    bounds = {"num_hidden_layers": 40, "hidden_size": 1280, "num_attention_heads": 64,
              "intermediate_size": 8192, "vocab_size": 131072, "max_position_embeddings": 131072}
    if any(type(raw.get(k)) is not int or not 0 < raw[k] <= n for k, n in bounds.items()):
        raise Invalid("The model dimensions exceed the CPU workshop limits.")
    h, heads, layers = (raw[k] for k in ("hidden_size", "num_attention_heads", "num_hidden_layers"))
    kv = raw.get("num_key_value_heads", heads)
    dim = raw.get("head_dim", h // heads)
    if (h % heads or type(kv) is not int or not 0 < kv <= heads or heads % kv or dim != h // heads or dim % 2
            or raw.get("rope_scaling") or raw.get("quantization_config") or raw["max_position_embeddings"] < 80):
        raise Invalid("This checkpoint uses an unsupported attention, context, or quantization configuration.")
    parameters = h * raw["vocab_size"] * (1 if raw.get("tie_word_embeddings") else 2)
    parameters += layers * (2*h*h + 2*h*kv*dim + 3*h*raw["intermediate_size"])
    if parameters > 160_000_000:
        raise Invalid("Use a model with at most 160 million parameters.")
    # Build an explicit native architecture. An imported config cannot select code or a provider.
    allowed = (*bounds, "num_key_value_heads", "bos_token_id", "eos_token_id", "pad_token_id",
               "tie_word_embeddings", "rope_theta", "rms_norm_eps", "attention_bias", "mlp_bias", "hidden_act")
    for key in ("rope_theta", "rms_norm_eps"):
        number = raw.get(key, 1)
        if not isinstance(number, (int, float)) or not math.isfinite(number) or number <= 0:
            raise Invalid("The checkpoint has invalid normalization or rotary parameters.")
    for key in ("tie_word_embeddings", "attention_bias", "mlp_bias"):
        if key in raw and type(raw[key]) is not bool:
            raise Invalid("The checkpoint contains invalid architecture flags.")
    if raw.get("hidden_act", "silu") != "silu":
        raise Invalid("The CPU workshop expects the standard Llama SiLU activation.")
    if type(raw.get("eos_token_id")) is not int or not 0 <= raw["eos_token_id"] < raw["vocab_size"]:
        raise Invalid("The checkpoint needs a valid end token.")
    return {k: raw[k] for k in allowed if k in raw}


def load_model(record):
    import torch
    from safetensors.torch import load
    from tokenizers import Tokenizer
    from transformers import LlamaConfig, LlamaForCausalLM, PreTrainedTokenizerFast
    item, path = record
    artifact, _, data = snapshot(path, keep=True)
    if artifact != item["artifactSHA256"]:
        raise Invalid("The selected snapshot changed. Refresh the model list.")
    config = LlamaConfig(**validated_config(json.loads(data["config.json"])), attn_implementation="eager")
    tokenizer = PreTrainedTokenizerFast(tokenizer_object=Tokenizer.from_str(data["tokenizer.json"].decode()))
    tokenizer.model_input_names = ["input_ids", "attention_mask"]
    if len(tokenizer) > config.vocab_size or tokenizer.convert_ids_to_tokens(config.eos_token_id) is None:
        raise Invalid("The tokenizer vocabulary is incompatible with the weights.")
    if isinstance(config.eos_token_id, int):
        tokenizer.eos_token = tokenizer.convert_ids_to_tokens(config.eos_token_id)
        tokenizer.pad_token = tokenizer.eos_token
    if tokenizer.eos_token is None or tokenizer.pad_token_id is None:
        raise Invalid("The snapshot needs a valid tokenizer end token.")
    weights = load(data.pop("model.safetensors"))
    if config.tie_word_embeddings:
        if "lm_head.weight" in weights and "model.embed_tokens.weight" not in weights:
            weights["model.embed_tokens.weight"] = weights["lm_head.weight"]
        if "lm_head.weight" not in weights:
            weights["lm_head.weight"] = weights["model.embed_tokens.weight"]
        if not torch.equal(weights["model.embed_tokens.weight"], weights["lm_head.weight"]):
            raise Invalid("The checkpoint has inconsistent tied weights.")
    model = LlamaForCausalLM(config)
    if any(not w.is_floating_point() or not torch.isfinite(w).all() for w in weights.values()):
        raise Invalid("The weights contain non-finite or unsupported values.")
    model.load_state_dict(weights, strict=True)
    model.eval()
    return model, tokenizer, data


def logits(model, tokenizer, question):
    import torch
    batch = tokenizer(question + "\n", return_tensors="pt", return_token_type_ids=False)
    if not 1 <= batch.input_ids.shape[1] <= min(512, model.config.max_position_embeddings - 16):
        raise Invalid("The question exceeds this model's token limit.")
    # Each tokenizer can differ. Choose its contextual continuation for each label.
    choices = []
    prefix = batch.input_ids[0].tolist()
    for label in ("no", "yes"):
        sequence = tokenizer.encode(question + "\n" + label, add_special_tokens=True)
        if len(sequence) != len(prefix) + 1 or sequence[:-1] != prefix or sequence[-1] == tokenizer.unk_token_id:
            raise Invalid("The tokenizer must encode yes and no as distinct single-token continuations.")
        choices.append(sequence[-1])
    if choices[0] == choices[1]:
        raise Invalid("The tokenizer does not distinguish the two document labels.")
    output = model(**batch, use_cache=False).logits[0, -1, choices].float()
    if not torch.isfinite(output).all():
        raise Invalid("The model returned non-finite scores.")
    return output


def grade(model, tokenizer):
    import torch
    model.eval()
    with torch.no_grad():
        correct = sum(logits(model, tokenizer, prompt(row)).argmax().item() == int(row[2]) for row in HOLDOUT)
    return dict(correct=correct, total=len(HOLDOUT))


def find_record(records, ident):
    if not isinstance(ident, str) or ident not in records:
        raise Invalid("The selected model is unavailable. Refresh the model list.")
    return records[ident]


def adapter_target_digest(model):
    digest = hashlib.sha256()
    for name, tensor in model.named_parameters():
        if name.endswith((".q_proj.weight", ".v_proj.weight")):
            digest.update(name.encode())
            digest.update(memoryview(tensor.detach().contiguous().numpy()))
    return digest.hexdigest()


def build_id(recipe, versions, parents, name):
    return "candidate-" + hash_json([recipe, versions, parents, TRAIN, HOLDOUT, name])


def through_step(request):
    target = request.get("throughStep", TOTAL_STEPS)
    if type(target) is not int or not 1 <= target <= TOTAL_STEPS:
        raise Invalid("Choose a training stop between step 1 and 24.")
    return target


def draft_summary(manifest):
    return {key: manifest[key] for key in ("id", "name", "parents", "completedSteps", "totalSteps")}


def checkpoint_binding(ident, name, base, teacher, versions):
    return dict(format=1, id=ident, name=name, parents={"base":base["id"], "teacher":teacher["id"]},
                parentArtifacts={"base":base["artifactSHA256"], "teacher":teacher["artifactSHA256"]},
                recipe=RECIPE, runtimeVersions=versions, trainingSHA256=hash_json(TRAIN),
                evaluationSHA256=hash_json(HOLDOUT), totalSteps=TOTAL_STEPS,
                optimizer="AdamW", learningRate=LEARNING_RATE, lora=LORA)


def checked_draft(path, records, versions=None, with_state=False):
    try:
        manifest, tensors = checkpoint.read(path, with_state)
    except checkpoint.InvalidCheckpoint as exc:
        raise Invalid(str(exc)) from exc
    try:
        name = check_name(manifest["name"])
        parents = manifest["parents"]
        base = find_record(records, parents["base"])[0]
        teacher = find_record(records, parents["teacher"])[0]
        runtime = manifest["runtimeVersions"]
        ident = build_id(RECIPE, runtime, parents, name)
        expected = checkpoint_binding(ident, name, base, teacher, runtime)
        if (not isinstance(runtime, list) or len(runtime) != 4
                or not all(isinstance(v, str) and 0 < len(v) <= 128 for v in runtime)
                or path.name != ident + ".safetensors"
                or set(manifest) != set(expected) | {"completedSteps", "teacherSignalSHA256"}
                or any(manifest[key] != value for key, value in expected.items())
                or type(manifest["completedSteps"]) is not int or not 1 <= manifest["completedSteps"] <= TOTAL_STEPS
                or not re.fullmatch(r"[0-9a-f]{64}", manifest["teacherSignalSHA256"])):
            raise ValueError("incompatible manifest")
        if versions is not None and versions != runtime:
            raise Invalid("The checkpoint requires its original CPU training runtime versions.")
        return manifest, tensors
    except (KeyError, TypeError, ValueError, RecursionError) as exc:
        if isinstance(exc, Invalid):
            raise
        raise Invalid("The checkpoint does not match its parents or training recipe.") from exc


def pending_files(directory):
    files = []
    for path in directory.iterdir():
        if re.fullmatch(r"candidate-[0-9a-f]{64}\.safetensors", path.name):
            files.append(path)
            if len(files) > checkpoint.MAX_DRAFTS:
                raise Invalid("The training workspace exceeds its draft limit.")
    return files


def list_drafts(root, records):
    if not os.path.lexists(root / "drafts"):
        return []
    drafts = []
    for path in sorted(pending_files(parent_directory(root, "drafts"))):
        if path.stem in records:  # A process may have died after publishing a complete candidate.
            checkpoint.remove(path)
            continue
        try:
            manifest, _ = checked_draft(path, records)
            drafts.append(draft_summary(manifest))
        except (Invalid, checkpoint.InvalidCheckpoint):
            continue
    return drafts


def clear_publication_stage(stage):
    # This slot is underneath the worker-marked directory. Unexpected content
    # requires operator attention; never recursively delete a shared location.
    if not os.path.lexists(stage):
        return
    if stage.is_symlink() or not stage.is_dir():
        raise Invalid("The worker publication slot contains an unexpected entry.")
    files = list(stage.iterdir())
    if any(entry.name not in (*FILES, "workshop.json") or not stat.S_ISREG(entry.lstat().st_mode)
           for entry in files):
        raise Invalid("The worker publication slot contains unrecognized files.")
    for file in files:
        file.unlink()
    stage.rmdir()


def publication_stage(target):
    owned = parent_directory(target, ".workshop-publish-v1", create=True)
    marker = owned / ".owned-by-model-workshop"
    if not os.path.lexists(marker):
        if any(owned.iterdir()):
            raise Invalid("The worker publication directory is already occupied.")
        with marker.open("xb"):
            pass
    if not stat.S_ISREG(marker.lstat().st_mode) or marker.stat().st_size != 0:
        raise Invalid("The worker publication directory has an invalid ownership marker.")
    stage = owned / "stage"
    clear_publication_stage(stage)
    stage.mkdir(mode=0o700)
    checkpoint.fsync_dir(owned)
    return stage


def build(root, records, request, versions):
    import torch
    from peft import get_peft_model, LoraConfig
    from safetensors.torch import save_file
    stop = through_step(request)
    base_record = find_record(records, request.get("base"))
    teacher_record = find_record(records, request.get("teacher"))
    base, teacher = base_record[0], teacher_record[0]
    if base["artifactSHA256"] == teacher["artifactSHA256"] or base["weightsSHA256"] == teacher["weightsSHA256"]:
        raise Invalid("Choose two parents with different weights.")
    name = check_name(request.get("name"))
    parents = dict(base=base["id"], teacher=teacher["id"])
    ident = build_id(RECIPE, versions, parents, name)
    if ident in records:
        return load_report(records[ident][1])
    target = parent_directory(root, "candidates", create=True)
    if (target / ident).exists():
        raise Invalid("The existing candidate failed its integrity check.")
    draft_dir = parent_directory(root, "drafts", create=True)
    checkpoint.fsync_dir(root)
    draft_path = draft_dir / (ident + ".safetensors")
    start = 0
    saved_state = None
    binding = checkpoint_binding(ident, name, base, teacher, versions)
    reserved = set()
    for path in pending_files(draft_dir):
        if path.stem in records:
            checkpoint.remove(path)
        else:
            reserved.add(path.stem)
    if ident not in reserved and len(records) + len(reserved) >= 128:
        raise Invalid("The catalog slots are occupied or reserved for pending drafts. Archive a model before building.")
    if len(records) >= 128:
        raise Invalid("The local catalog is full. Archive a model to finish this draft.")
    if os.path.lexists(draft_path):
        previous, saved_state = checked_draft(draft_path, records, versions, with_state=True)
        start = previous["completedSteps"]
    elif len(reserved) >= checkpoint.MAX_DRAFTS:
        raise Invalid("Finish or archive an existing draft before starting another training run.")
    teacher_net, teacher_tok, _ = load_model(teacher_record)
    verified = []
    with torch.no_grad():
        for row in TRAIN:
            prob = logits(teacher_net, teacher_tok, prompt(row)).softmax(0)
            if prob.argmax().item() == int(row[2]) and prob.max().item() >= 0.55:
                verified.append((row, prob))
        teacher_score = grade(teacher_net, teacher_tok)
    if {row[2] for row, _ in verified} != {True, False}:
        raise Invalid("The teacher must produce confident, correct examples for both document labels.")
    del teacher_net
    binding["teacherSignalSHA256"] = hash_json([(row, prob.tolist()) for row, prob in verified])
    if saved_state is not None and previous["teacherSignalSHA256"] != binding["teacherSignalSHA256"]:
        raise Invalid("The teacher signal differs from the saved checkpoint.")
    base_net, base_tok, data = load_model(base_record)
    initial_targets = adapter_target_digest(base_net)
    scores = {"base": grade(base_net, base_tok), "teacher": teacher_score}
    lora = get_peft_model(base_net, LoraConfig(**LORA))
    lora.train()
    optimizer = torch.optim.AdamW((p for p in lora.parameters() if p.requires_grad), lr=LEARNING_RATE)
    if saved_state is not None:
        try:
            checkpoint.restore(saved_state, lora, optimizer, start)
        except checkpoint.InvalidCheckpoint as exc:
            raise Invalid(str(exc)) from exc
    if start >= stop and stop < TOTAL_STEPS:
        return {"draft": draft_summary(previous)}
    for step in range(start, stop):
        row, soft_target = verified[step % len(verified)]
        scores2 = logits(lora, base_tok, prompt(row)).log_softmax(0)
        loss = -(soft_target * scores2).sum()
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        optimizer.step()
        done = step + 1
        if done % CHECKPOINT_INTERVAL == 0 or done == stop:
            manifest = {**binding, "completedSteps": done}
            checkpoint.save(draft_path, manifest, lora, optimizer)
    if stop < TOTAL_STEPS:
        return {"draft": draft_summary(manifest)}
    model = lora.merge_and_unload(safe_merge=True).eval()
    if adapter_target_digest(model) == initial_targets:
        raise Invalid("The teacher signal produced no change to the base weights.")
    stage = publication_stage(target)
    try:
        for file, raw in data.items():
            (stage / file).write_bytes(raw)
        state = model.state_dict()
        if model.config.tie_word_embeddings:
            del state["lm_head.weight"]
        save_file(state, str(stage / "model.safetensors"), metadata={"format": "pt"})
        artifact, weight_hash, _ = snapshot(stage)
        item = dict(id=ident, name=name, kind="candidate", parents=parents, artifactSHA256=artifact, weightsSHA256=weight_hash)
        del state, model, lora, base_net, optimizer
        frozen, tok, _ = load_model((item, stage))
        scores["candidate"] = grade(frozen, tok)
        report = dict(candidate=item, scores=scores, verifiedExamples=len(verified), trainingExamples=len(TRAIN),
                      recipe=RECIPE, steps=TOTAL_STEPS, comparison="constrained yes/no", runtimeVersions=versions,
                      trainingSHA256=hash_json(TRAIN), evaluationSHA256=hash_json(HOLDOUT))
        (stage / "workshop.json").write_text(json.dumps(report, allow_nan=False))
        for file in stage.iterdir():
            with file.open("rb") as handle:
                os.fsync(handle.fileno())
        checkpoint.fsync_dir(stage)
        stage.rename(target / ident)
        checkpoint.fsync_dir(stage.parent)
        checkpoint.fsync_dir(target)
        checkpoint.remove(draft_path)
        return report
    finally:
        clear_publication_stage(stage)


def run(request):
    if not isinstance(request, dict):
        raise Invalid("Expected one JSON object.")
    root = Path(os.environ.get("POCKET_TRAINING_DIR", ""))
    if not root.is_absolute() or not root.is_dir() or root.is_symlink():
        raise Invalid("Configure an absolute local training directory to enable the CPU workshop.")
    with (root / ".workshop.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Invalid("The CPU workshop is busy. Retry after the current request.") from None
        records = catalog(root)
        operation = request.get("op")
        if operation == "list":
            reply = {"models": [item for item, _ in records.values()]}
            drafts = list_drafts(root, records)
            if drafts:
                reply["drafts"] = drafts
            return reply
        versions = dependencies()
        if operation == "resume":
            stop = through_step(request)
            ident = request.get("draft")
            if not isinstance(ident, str) or not re.fullmatch(r"candidate-[0-9a-f]{64}", ident):
                raise Invalid("Choose a saved training draft.")
            if ident in records:
                return load_report(records[ident][1])
            if not os.path.lexists(root / "drafts"):
                raise Invalid("The selected training draft is unavailable.")
            path = parent_directory(root, "drafts") / (ident + ".safetensors")
            if not os.path.lexists(path):
                raise Invalid("The selected training draft is unavailable.")
            manifest, _ = checked_draft(path, records, versions)
            return build(root, records, {**manifest["parents"], "name": manifest["name"], "throughStep": stop}, versions)
        if operation == "build":
            return build(root, records, request, versions)
        if operation == "answer":
            question = request.get("question")
            if not isinstance(question, str) or not question.strip() or len(question) > 2000:
                raise Invalid("Enter a question of 1 to 2,000 characters.")
            ident = request.get("model")
            model, tokenizer, _ = load_model(find_record(records, ident))
            if len(tokenizer.encode(question + "\n")) > min(512, model.config.max_position_embeddings - 16):
                raise Invalid("The question exceeds this model's token limit.")
            result = evaluate(model, tokenizer, [{"id": "requested", "prompt": question, "completion": ""}])
            answer = result["predictions"][0]["prediction"]
            if not answer:
                raise Invalid("The selected model generated no text.")
            return {"answer": answer, "model": ident}
        raise Invalid("Unsupported training operation.")


def main():
    try:
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384:
            raise Invalid("The workshop request is too large.")
        request = json.loads(raw)
        with contextlib.redirect_stdout(sys.stderr):
            reply = run(request)
    except (Invalid, checkpoint.InvalidCheckpoint) as exc:
        reply = {"error": str(exc)}
    except Exception:
        reply = {"error": "The CPU worker could not read or process this local checkpoint."}
    print(json.dumps(reply, allow_nan=False))


if __name__ == "__main__":
    main()
