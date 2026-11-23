"""Offline two-parent CPU LoRA worker. One bounded JSON request and reply per process."""
import contextlib
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from train import evaluate

RECIPE = "document-verification-lora-v1"
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
            if len(records) >= 128:
                raise Invalid("The local catalog exceeds its 128-model limit.")
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
                    if item["id"] != path.name or item["artifactSHA256"] != artifact or item["weightsSHA256"] != weights:
                        continue
                item.update(artifactSHA256=artifact, weightsSHA256=weights)
                records.setdefault(item["id"], (item, path))
            except (OSError, KeyError, TypeError, ValueError):
                continue
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


def build(root, records, request, versions):
    import torch
    from peft import get_peft_model, LoraConfig
    from safetensors.torch import save_file
    base_record = find_record(records, request.get("base"))
    teacher_record = find_record(records, request.get("teacher"))
    base, teacher = base_record[0], teacher_record[0]
    if base["artifactSHA256"] == teacher["artifactSHA256"] or base["weightsSHA256"] == teacher["weightsSHA256"]:
        raise Invalid("Choose two parents with different weights.")
    name = check_name(request.get("name"))
    parents = dict(base=base["id"], teacher=teacher["id"])
    key = hash_json([RECIPE, versions, parents, TRAIN, HOLDOUT, name])
    ident = "candidate-" + key
    if ident in records:
        return load_report(records[ident][1])
    target = parent_directory(root, "candidates", create=True)
    if (target / ident).exists():
        raise Invalid("The existing candidate failed its integrity check.")
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
    base_net, base_tok, data = load_model(base_record)
    initial_targets = adapter_target_digest(base_net)
    scores = {"base": grade(base_net, base_tok), "teacher": teacher_score}
    lora = get_peft_model(base_net, LoraConfig(r=4, lora_alpha=8, target_modules=["q_proj", "v_proj"],
                                               lora_dropout=0.0, bias="none", task_type="CAUSAL_LM"))
    lora.train()
    optimizer = torch.optim.AdamW((p for p in lora.parameters() if p.requires_grad), lr=0.003)
    for step in range(24):
        row, soft_target = verified[step % len(verified)]
        scores2 = logits(lora, base_tok, prompt(row)).log_softmax(0)
        loss = -(soft_target * scores2).sum()
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        optimizer.step()
    model = lora.merge_and_unload(safe_merge=True).eval()
    if adapter_target_digest(model) == initial_targets:
        raise Invalid("The teacher signal produced no change to the base weights.")
    stage = Path(tempfile.mkdtemp(prefix=".stage-", dir=target))
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
                      recipe=RECIPE, steps=24, comparison="constrained yes/no", runtimeVersions=versions,
                      trainingSHA256=hash_json(TRAIN), evaluationSHA256=hash_json(HOLDOUT))
        (stage / "workshop.json").write_text(json.dumps(report, allow_nan=False))
        stage.rename(target / ident)
        return report
    finally:
        shutil.rmtree(stage, ignore_errors=True)


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
            return {"models": [item for item, _ in records.values()]}
        versions = dependencies()
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
    except Invalid as exc:
        reply = {"error": str(exc)}
    except Exception:
        reply = {"error": "The CPU worker could not read or process this local checkpoint."}
    print(json.dumps(reply, allow_nan=False))


if __name__ == "__main__":
    main()
