#!/usr/bin/env python3
"""Prepare and independently audit the separately frozen recipient format pilot.

This tool never performs inference and never changes or rescores recipient v1.
Successful audits establish consistency of supplied evidence, not authentication
of the runner or independent proof that the model executed. The workflow owns
source provenance and must also require success of the native tokenizer runner,
including its post-execution model hash check.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import uuid


MANIFEST_SHA256 = "95acbcd4237899a2234fd9c16f5e86823cec1595e6922c96cb54851d15432992"
MANIFEST_BYTES = 44072
MODEL_SHA256 = "2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d"
MODEL_BYTES = 105454432
LLAMA_COMMIT = "5f490d7bfe78844e6390c869454c149fd7e003a8"
LLAMA_TAG = "b12233"
MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_LOG_BYTES = 16 * 1024 * 1024
MAX_LINE_BYTES = 256 * 1024
MAX_CAPTURE_BYTES = 2 * 1024 * 1024
MAX_RECORDS = 512
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
FORMATS = ("raw", "chat")
CONDITIONS = ("correct", "absent", "counterfactual")
MARKER = re.compile(rb"(?:^|\s)POCKET_RECIPIENT_FORMAT_(START|TRIAL|SUMMARY) (.*)\Z")


class EvidenceError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise EvidenceError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def integer(value, minimum=0, maximum=2**53 - 1):
    return type(value) is int and minimum <= value <= maximum


def exact(value, expected):
    # Python considers True == 1 and 1 == 1.0; evidence schema does not.
    return type(value) is type(expected) and value == expected


def _object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON key: " + key)
        result[key] = value
    return result


def _nonfinite(value):
    raise EvidenceError("Non-finite JSON number: " + value)


def strict_json(raw):
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_object,
                           parse_constant=_nonfinite)
        pending = [(value, 0)]
        count = 0
        while pending:
            item, depth = pending.pop()
            count += 1
            require(depth <= 24 and count <= 100000, "JSON structural bound exceeded")
            if isinstance(item, float):
                require(math.isfinite(item), "Non-finite JSON number")
            elif isinstance(item, dict):
                pending.extend((child, depth + 1) for child in item.values())
            elif isinstance(item, list):
                pending.extend((child, depth + 1) for child in item)
        return value
    except (UnicodeDecodeError, ValueError, RecursionError) as error:
        if isinstance(error, EvidenceError):
            raise
        raise EvidenceError("Invalid UTF-8 JSON") from error


def _open_regular(path):
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NONBLOCK", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        require(stat.S_ISREG(os.fstat(descriptor).st_mode), "Input is not a regular file")
        return os.fdopen(descriptor, "rb")
    except BaseException:
        os.close(descriptor)
        raise


def bounded_read(path, maximum):
    with _open_regular(path) as source:
        require(os.fstat(source.fileno()).st_size <= maximum, "Input byte bound exceeded")
        raw = source.read(maximum + 1)
    require(len(raw) <= maximum, "Input grew beyond byte bound")
    return raw


def load_json(path, maximum=MAX_JSON_BYTES):
    return strict_json(bounded_read(path, maximum))


def encoded_json(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=True,
                       allow_nan=False) + "\n").encode("utf-8")


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("ascii")


def check_output(output, inputs):
    resolved = output.resolve()
    require(not output.is_symlink(), "Output must not be a symlink")
    for item in inputs:
        require(resolved != item.resolve(), "Output aliases an input")
        if output.exists() and item.exists():
            require(not os.path.samefile(output, item), "Output hard-links an input")


def fresh_directory(output, inputs):
    check_output(output, inputs)
    require(not os.path.lexists(output), "Output directory must be fresh")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.mkdir()


def atomic_write(output, raw, inputs=()):
    require(len(raw) <= MAX_OUTPUT_BYTES, "Output byte bound exceeded")
    check_output(output, inputs)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=output.parent, prefix=".format-audit-", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def load_manifest(path):
    raw = bounded_read(path, MANIFEST_BYTES)
    require(len(raw) == MANIFEST_BYTES and sha256(raw) == MANIFEST_SHA256,
            "Frozen manifest bytes or SHA-256 differ")
    manifest = strict_json(raw)
    require(manifest["model"]["sha256"] == MODEL_SHA256 and
            manifest["model"]["bytes"] == MODEL_BYTES, "Manifest model pin differs")
    require(manifest["trialCount"] == 72 and len(manifest["trials"]) == 72,
            "Manifest schedule differs")
    for index, trial in enumerate(manifest["trials"], 1):
        prompt = trial["prompt"].encode("ascii")
        require(trial["ordinal"] == index and 0 < len(prompt) <= 1024 and b"\0" not in prompt,
                "Manifest prompt bounds differ")
        require(sha256(prompt) == trial["promptSHA256"], "Manifest prompt digest differs")
    return manifest, raw


def verify_model_file(path, size, digest):
    with _open_regular(path) as source:
        before = os.fstat(source.fileno())
        require(before.st_size == size, "Model size differs from frozen pin")
        count = 0
        hasher = hashlib.sha256()
        while count <= size:
            data = source.read(min(1024 * 1024, size + 1 - count))
            if not data:
                break
            hasher.update(data)
            count += len(data)
        after = os.fstat(source.fileno())
        require(count == size and after.st_size == size and hasher.hexdigest() == digest,
                "Whole model bytes differ from frozen pin")
        require(before.st_mtime_ns == after.st_mtime_ns, "Model changed during verification")


def validate_metadata(metadata, manifest):
    require(isinstance(metadata, dict), "Metadata must be an object")
    require(exact(metadata.get("schemaVersion"), 1), "Metadata schema differs")
    require(metadata.get("probe") == "pinned-gguf-recipient-template-metadata", "Wrong metadata probe")
    model = metadata.get("verifiedModel")
    require(isinstance(model, dict) and model.get("sha256") == MODEL_SHA256 and
            exact(model.get("bytes"), MODEL_BYTES), "Metadata model pin differs")
    template = metadata.get("chatTemplate")
    require(isinstance(template, dict), "Metadata template missing")
    expected = manifest["template"]
    require(template.get("text") == expected["text"] and
            template.get("sha256") == expected["sha256"] and
            exact(template.get("utf8ByteLength"), expected["utf8ByteLength"]), "Metadata template differs")
    try:
        raw = base64.b64decode(template["utf8Base64"], validate=True)
    except (KeyError, ValueError, TypeError) as error:
        raise EvidenceError("Template Base64 is invalid") from error
    require(raw == expected["text"].encode("utf-8"), "Template Base64/text mismatch")
    boundary = metadata.get("evidenceBoundary", {})
    require(isinstance(boundary, dict), "Metadata execution boundary must be an object")
    for name in ("templateRendered", "tokenizationExecuted", "inferenceExecuted",
                 "runtimeDefaultFlagsInferred", "recipientQualityEstablished"):
        require(boundary.get(name) is False, "Metadata execution boundary differs: " + name)
    tokenizer = metadata.get("tokenizerMetadata", {})
    require(isinstance(tokenizer, dict), "Declared tokenizer metadata must be an object")
    for name, value in {"tokenizer.ggml.model":"gpt2", "tokenizer.ggml.pre":"smollm",
                        "tokenizer.ggml.add_bos_token":False, "tokenizer.ggml.add_space_prefix":False}.items():
        require(exact(tokenizer.get(name), value), "Declared tokenizer metadata differs: " + name)


def prepare(manifest_path, metadata_path, model_path, output):
    manifest, raw = load_manifest(manifest_path)
    metadata_raw = bounded_read(metadata_path, MAX_JSON_BYTES)
    validate_metadata(strict_json(metadata_raw), manifest)
    verify_model_file(model_path, MODEL_BYTES, MODEL_SHA256)
    fresh_directory(output, (manifest_path, metadata_path, model_path))
    (output / "prompts").mkdir()
    atomic_write(output / "manifest.json", raw)
    for row in manifest["trials"]:
        atomic_write(output / "prompts" / (f'{row["ordinal"]:03}.txt'), row["prompt"].encode("ascii"))
    atomic_write(output / "preparation.json", encoded_json({
        "reportKind":"recipient-format-preparation", "manifestSHA256":MANIFEST_SHA256,
        "modelSHA256":MODEL_SHA256, "modelBytes":MODEL_BYTES,
        "metadataSHA256":sha256(metadata_raw), "promptCount":72,
        "inferencePerformed":False, "templateExecutionPerformed":False,
        "note":"Exact prompt bytes copied from the precommitted manifest after model and metadata checks."
    }))


def capture_tokenizer(path):
    records, errors = [], []
    raw = b""
    try:
        raw = bounded_read(path, MAX_JSON_BYTES)
        for number, line in enumerate(raw.splitlines(), 1):
            require(number <= 80, "Tokenizer record bound exceeded")
            require(len(line) <= MAX_LINE_BYTES, "Tokenizer line bound exceeded")
            try:
                record = strict_json(line)
                require(isinstance(record, dict), "Tokenizer row must be an object")
                records.append(record)
            except EvidenceError as error:
                errors.append(f"line {number}: {error}")
    except (OSError, EvidenceError) as error:
        errors.append(str(error))
    return records, errors, raw


def keys(record, expected, label):
    require(isinstance(record, dict) and set(record) == set(expected.split()), label + " fields differ")


def token_ids(value, vocabulary_size):
    return isinstance(value, list) and 0 < len(value) <= 4096 and all(
        integer(token, 0, vocabulary_size - 1) for token in value)


def validate_tokenizer(records, manifest):
    require(isinstance(records, list) and len(records) == 75, "Expected start, vocabulary, 72 prompts and summary")
    start, vocabulary, summary = records[0], records[1], records[-1]
    keys(start, "recordType schemaVersion mode inferencePerformed contextCreated requestedPromptCount maximumPromptBytes maximumTokens llamaCppPinTag llamaCppPinCommit", "Tokenizer start")
    expected_start = {"recordType":"start", "schemaVersion":1, "mode":"vocab-only", "inferencePerformed":False,
                      "contextCreated":False, "requestedPromptCount":72, "maximumPromptBytes":1024,
                      "maximumTokens":4096, "llamaCppPinTag":LLAMA_TAG, "llamaCppPinCommit":LLAMA_COMMIT}
    require(all(exact(start[k], v) for k,v in expected_start.items()), "Tokenizer start contract differs")
    keys(vocabulary, "recordType vocabularySize effectiveAddBOS effectiveAddEOS bosTokenID eosTokenID templateByteCount templateUTF8Hex markers", "Vocabulary")
    require(vocabulary["recordType"] == "vocabulary" and exact(vocabulary["vocabularySize"],49152), "Vocabulary identity differs")
    require(vocabulary["effectiveAddBOS"] is False and vocabulary["effectiveAddEOS"] is False, "Effective BOS/EOS insertion differs")
    require(exact(vocabulary["bosTokenID"],1) and exact(vocabulary["eosTokenID"],2), "BOS/EOS token IDs differ")
    template_bytes = manifest["template"]["text"].encode("utf-8")
    require(exact(vocabulary["templateByteCount"],len(template_bytes)) and vocabulary["templateUTF8Hex"] == template_bytes.hex(), "Effective template bytes differ")
    markers = vocabulary["markers"]
    require(isinstance(markers,list) and len(markers)==3, "Expected three marker observations")
    for marker, spelling, expected_id in zip(markers,("<|im_start|>","<|im_end|>","<|endoftext|>"),(1,2,0)):
        keys(marker, "spelling tokenID attributes isEOG isolatedAddSpecial parseSpecialTrueTokenIDs parseSpecialFalseTokenIDs", "Marker")
        require(marker["spelling"]==spelling and exact(marker["tokenID"],expected_id), "Marker identity differs")
        require(integer(marker["attributes"],0,65535) and type(marker["isEOG"]) is bool and marker["isolatedAddSpecial"] is False, "Marker attributes or switches invalid")
        for name in ("parseSpecialTrueTokenIDs","parseSpecialFalseTokenIDs"):
            require(token_ids(marker[name],49152), "Marker token sequence invalid")
        if expected_id in (1,2):
            require(marker["parseSpecialTrueTokenIDs"] == [expected_id] and marker["parseSpecialFalseTokenIDs"] != [expected_id], "Marker special parsing was not distinguished")
    for observed, expected in zip(records[2:-1], manifest["trials"]):
        keys(observed, "recordType ordinal promptByteCount promptASCII addSpecial parseSpecial tokenCount tokenIDs detokenizeRemoveSpecial detokenizeUnparseSpecial detokenizedByteCount detokenizedUTF8Hex", "Prompt")
        prompt = expected["prompt"].encode("ascii")
        require(observed["recordType"]=="prompt" and exact(observed["ordinal"],expected["ordinal"]), "Prompt ordering differs")
        require(exact(observed["promptByteCount"],len(prompt)) and observed["promptASCII"]==expected["prompt"], "Prompt bytes differ")
        require(observed["addSpecial"] is True and observed["parseSpecial"] is True and observed["detokenizeRemoveSpecial"] is False and observed["detokenizeUnparseSpecial"] is True, "Prompt tokenizer switches differ")
        tokens, count = observed["tokenIDs"], observed["tokenCount"]
        require(token_ids(tokens,49152) and integer(count,1,511) and count==len(tokens) and count+4<=512, "Prompt token count/context bound differs")
        require(tokens.count(1)==(3 if expected["format"]=="chat" else 0) and tokens.count(2)==(2 if expected["format"]=="chat" else 0), "Prompt role token counts differ")
        require(exact(observed["detokenizedByteCount"],len(prompt)) and observed["detokenizedUTF8Hex"]==prompt.hex(), "Exact detokenized bytes differ")
    keys(summary, "recordType status processedPromptCount inferencePerformed contextCreated", "Tokenizer summary")
    require(summary["recordType"]=="summary" and summary["status"]=="completed" and exact(summary["processedPromptCount"],72) and summary["inferencePerformed"] is False and summary["contextCreated"] is False, "Tokenizer completion differs")


def tokenizer(manifest_path, input_path, output):
    records, errors, raw = capture_tokenizer(input_path)
    try:
        manifest, _ = load_manifest(manifest_path)
        validate_tokenizer(records,manifest)
    except (OSError, EvidenceError, KeyError, TypeError) as error:
        errors.append(str(error))
    audit = {"reportKind":"recipient-format-tokenization-audit", "schemaVersion":1,
             "manifestSHA256":MANIFEST_SHA256, "inputSHA256":sha256(raw), "inputBytes":len(raw),
             "records":records, "normalizedRecordsSHA256":sha256(canonical_json(records)),
             "integritySuccess":not errors, "errors":errors,
             "evidenceBoundary":{"mode":"vocab-only", "inferencePerformed":False,
                                 "contextCreated":False, "runnerExitStatusVerified":False,
                                 "modelPostHashVerified":False,
                                 "note":"The workflow must separately require native runner success and its model post-hash check."}}
    atomic_write(output,encoded_json(audit),(manifest_path,input_path))
    return audit


def capture_log(path):
    records = {"START":[], "TRIAL":[], "SUMMARY":[]}
    errors, sequence, captured = [], [], bytearray()
    raw = b""
    try:
        raw = bounded_read(path, MAX_LOG_BYTES)
        for number,line in enumerate(raw.splitlines(keepends=True),1):
            # Limit every line before a regex; retain exact marker lines separately.
            require(len(line)<=MAX_LINE_BYTES,"Log line bound exceeded")
            match = MARKER.search(line.rstrip(b"\r\n"))
            if not match:
                continue
            require(len(sequence)<MAX_RECORDS and len(captured)+len(line)<=MAX_CAPTURE_BYTES,"Captured evidence bound exceeded")
            captured.extend(line)
            kind = match[1].decode("ascii")
            sequence.append(kind)
            try:
                record = strict_json(match[2])
                require(isinstance(record,dict),"Marker payload must be an object")
                records[kind].append(record)
            except EvidenceError as error:
                errors.append(f"line {number}: {error}")
    except (OSError,EvidenceError) as error:
        errors.append(str(error))
    return records, errors, sequence, bytes(captured), raw


def validate_start(start, manifest):
    keys(start,"schemaVersion manifestSHA256 modelArtifactSHA256 modelBytes modelId providerKind contextLength maxTokens temperature maxOutputBytes maximumDurationSeconds llamaCppPinTag llamaCppPinCommit offload","START")
    expected = {"schemaVersion":1,"manifestSHA256":MANIFEST_SHA256,"modelArtifactSHA256":MODEL_SHA256,
                "modelBytes":MODEL_BYTES,"modelId":"sha256-"+MODEL_SHA256,"providerKind":"llamaCpp",
                "contextLength":512,"maxTokens":4,"maxOutputBytes":128,"maximumDurationSeconds":900,
                "llamaCppPinTag":LLAMA_TAG,"llamaCppPinCommit":LLAMA_COMMIT}
    require(all(exact(start[k],v) for k,v in expected.items()),"START provenance/settings differ")
    require(type(start["temperature"]) in (int,float) and start["temperature"]==0,"Temperature differs")
    offload=start["offload"]
    keys(offload,"metalDeviceUsableAtLoad requestedGpuLayers offloadedLayers reportedLayerCount","Offload")
    require(type(offload["metalDeviceUsableAtLoad"]) is bool and exact(offload["requestedGpuLayers"],0),"Offload request differs")
    require(integer(offload["offloadedLayers"],-1,1000000) and integer(offload["reportedLayerCount"],-1,1000000),"Offload observation invalid")
    require(offload["reportedLayerCount"]<0 or offload["offloadedLayers"]<=offload["reportedLayerCount"],"Impossible offload observation")


def parse_answer(output):
    trimmed=output.encode("utf-8").strip(b" \t\r\n")
    return trimmed.decode("ascii") if trimmed in (b"A",b"B") else None


def validate_trial(row, expected):
    keys(row,"ordinal sourceTrialOrdinal caseId condition format requestId promptSHA256 rawOutput status parsedAnswer expectedAnswer scoredCorrect errorMessage latencyMilliseconds","TRIAL")
    for name in ("ordinal","sourceTrialOrdinal","caseId","condition","format","promptSHA256","expectedAnswer"):
        require(exact(row[name],expected[name]),"TRIAL does not match manifest: "+name)
    require(integer(row["latencyMilliseconds"],0,900000),"Invalid trial duration")
    require(type(row["scoredCorrect"]) is bool,"Score must be Boolean")
    status=row["status"]
    require(status in ("completed","generationFailed","notRunBudget"),"Unknown trial status")
    if status=="notRunBudget":
        require(row["requestId"] is None and row["rawOutput"] is None and row["parsedAnswer"] is None and row["scoredCorrect"] is False and row["latencyMilliseconds"]==0 and row["errorMessage"]=="The frozen between-request budget expired.","Budget row fabricated work")
        return
    request=row["requestId"]
    require(isinstance(request,str) and re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",request) is not None,"Request UUID must be canonical")
    identifier=uuid.UUID(request)
    require(identifier.version==4 and identifier.variant==uuid.RFC_4122,"Request UUID must be version 4")
    if status=="generationFailed":
        error=row["errorMessage"]
        require(isinstance(error,str) and 0<len(error.encode("utf-8"))<=4096,"Generation error missing or oversized")
        require(not re.search(r"cancelled|canceled|CancellationError|ModelPoolError",error,re.IGNORECASE),"Cancellation/pool error cannot be ordinary generation data")
        # String(describing:) of a ModelPoolError normally omits its enum type.
        # Those errors are propagated by the Swift runner, never ordinary data.
        pool_error = r"^(?:invalidConfiguration|invalidMemoryEstimate|invalidResourceSnapshot|insufficientMemory|modelLimitExceeded|descriptorConflict|modelBusy|modelLoading|activeLeases|invalidLease|activeUses|unknownModel|runtimeReturnedWrongModel|runtimeSessionCollision|modelLoadDidNotComplete)(?:\(|$)"
        require(re.search(pool_error,error) is None,"Pool/lease failure cannot be ordinary generation data")
        require(row["rawOutput"] is None and row["parsedAnswer"] is None and row["scoredCorrect"] is False,"Failed generation must preserve null output and zero score")
    else:
        output=row["rawOutput"]
        require(isinstance(output,str) and 0<len(output.encode("utf-8"))<=128 and output.encode("utf-8").strip(b" \t\r\n"),"Completed output must be bounded nonblank text")
        require(row["errorMessage"] is None,"Completed generation must have explicit null error")
        answer=parse_answer(output)
        require(exact(row["parsedAnswer"],answer) and row["scoredCorrect"]==(answer==expected["expectedAnswer"]),"Strict parser or score differs")


def validate_summary(summary, rows):
    keys(summary,"manifestSHA256 status elapsedMilliseconds modelArtifactSHA256After modelBytesAfter trials cleanup","SUMMARY")
    require(summary["manifestSHA256"]==MANIFEST_SHA256 and summary["modelArtifactSHA256After"]==MODEL_SHA256 and exact(summary["modelBytesAfter"],MODEL_BYTES),"SUMMARY model/manifest provenance differs")
    require(summary["status"]=="completed","Measurement did not complete within its budget")
    elapsed=summary["elapsedMilliseconds"]
    require(integer(elapsed,0,899999),"Invalid or expired measurement duration")
    require(canonical_json(summary["trials"])==canonical_json(rows),"Summary trials differ from incremental records")
    require(sum(row["latencyMilliseconds"] for row in rows)<=elapsed,"Trial durations exceed total elapsed duration")
    cleanup=summary["cleanup"]
    keys(cleanup,"leaseReleased activeLeaseCountBeforeRelease activeUseCountBeforeRelease activeRequestsBeforeRelease waitingRequestsBeforeRelease activeLeaseCount activeUseCount loadedModelIDs pendingModelIDs unloadingModelIDs reservedMemoryMB activeRequests waitingRequests","Cleanup")
    require(cleanup["leaseReleased"] is True and exact(cleanup["activeLeaseCountBeforeRelease"],1),"Lease release not established")
    for name in ("activeUseCountBeforeRelease","activeRequestsBeforeRelease","waitingRequestsBeforeRelease","activeLeaseCount","activeUseCount","reservedMemoryMB","activeRequests","waitingRequests"):
        require(exact(cleanup[name],0),"Cleanup not idle: "+name)
    for name in ("loadedModelIDs","pendingModelIDs","unloadingModelIDs"):
        require(isinstance(cleanup[name],list) and not cleanup[name],"Model cleanup incomplete: "+name)


def compute_metrics(rows):
    indexed={(r["format"],r["caseId"],r["condition"]):r for r in rows}
    formats={}
    cases=[f"case-{n:02}" for n in range(1,13)]
    def correct(row):
        return row is not None and row["scoredCorrect"] is True
    for format_name in FORMATS:
        all_rows=[r for r in rows if r["format"]==format_name]
        conditions={}
        for condition in CONDITIONS:
            group=[r for r in all_rows if r["condition"]==condition]
            count=sum(correct(r) for r in group)
            conditions[condition]={"denominator":12,"observedRows":len(group),"correctAnswerCount":count,"accuracy":count/12,
                "completedCount":sum(r["status"]=="completed" for r in group),
                "generationFailedCount":sum(r["status"]=="generationFailed" for r in group),
                "strictValidAnswerCount":sum(r["status"]=="completed" and r["parsedAnswer"] in ("A","B") for r in group)}
        pair_count=correct_only=absent_only=switches=0
        for case in cases:
            c=indexed.get((format_name,case,"correct"));a=indexed.get((format_name,case,"absent"));f=indexed.get((format_name,case,"counterfactual"))
            if c is not None and a is not None:
                pair_count+=1;correct_only+=correct(c) and not correct(a);absent_only+=correct(a) and not correct(c)
            if c is not None and f is not None:
                switches+=correct(c) and correct(f) and c["parsedAnswer"]!=f["parsedAnswer"]
        formats[format_name]={"denominator":36,"observedRows":len(all_rows),"unverifiedOrMissingRows":36-len(all_rows),
            "attemptedCount":sum(r["requestId"] is not None for r in all_rows),
            "completedCount":sum(r["status"]=="completed" for r in all_rows),
            "generationFailedCount":sum(r["status"]=="generationFailed" for r in all_rows),
            "notRunBudgetCount":sum(r["status"]=="notRunBudget" for r in all_rows),
            "invalidAnswerCount":sum(r["status"]=="completed" and r["parsedAnswer"] is None for r in all_rows),
            "strictValidAnswerCount":sum(r["status"]=="completed" and r["parsedAnswer"] in ("A","B") for r in all_rows),
            "conditions":conditions,"observedCorrectAbsentPairs":pair_count,"correctOnlyVsAbsentCount":correct_only,
            "absentOnlyVsCorrectCount":absent_only,"correctMinusAbsentAccuracy":(correct_only-absent_only)/12,
            "intendedCounterfactualSwitchCount":switches,"intendedCounterfactualSwitchRate":switches/12}
    paired={}
    for condition in CONDITIONS:
        observed=chat_only=raw_only=both=neither=0
        for case in cases:
            c=indexed.get(("chat",case,condition));r=indexed.get(("raw",case,condition))
            if c is None or r is None:
                continue
            observed+=1;chat_only+=correct(c) and not correct(r);raw_only+=correct(r) and not correct(c)
            both+=correct(c) and correct(r);neither+=not correct(c) and not correct(r)
        paired[condition]={"denominator":12,"observedPairs":observed,"chatOnlyCorrect":chat_only,"rawOnlyCorrect":raw_only,
                           "bothCorrect":both,"neitherCorrect":neither,"chatMinusRawAccuracy":(chat_only-raw_only)/12}
    return {"perFormat":formats,"pairedFormatsByCondition":paired,"taskQualityInterpretation":"Descriptive only; format feasibility does not establish useful private-fact or GIE communication."}


def verify(manifest_path, log_path, tokenizer_path, output):
    fresh_directory(output,(manifest_path,log_path,tokenizer_path))
    records,errors,sequence,raw_markers,raw_log=capture_log(log_path)
    # Preserve all parsed observations and parsing failures before any acceptance check.
    for kind,values in records.items():
        atomic_write(output/(kind.lower()+".jsonl"),b"".join(canonical_json(v)+b"\n" for v in values))
    atomic_write(output/"raw-markers.log",raw_markers)
    capture={"recordCounts":{k:len(v) for k,v in records.items()},"sequence":sequence,"captureErrors":errors.copy(),
             "sourceLogSHA256":sha256(raw_log),"sourceLogBytes":len(raw_log),
             "syntheticFixtureLabelPresent":b"SYNTHETIC FIXTURE ONLY" in raw_log}
    atomic_write(output/"capture-status.json",encoded_json(capture))
    valid=[]
    tokenizer_digest=None
    try:
        manifest,_=load_manifest(manifest_path)
        token_raw=bounded_read(tokenizer_path,MAX_JSON_BYTES);tokenizer_digest=sha256(token_raw)
        token_audit=strict_json(token_raw)
        require(isinstance(token_audit,dict) and exact(token_audit.get("schemaVersion"),1) and token_audit.get("reportKind")=="recipient-format-tokenization-audit" and
                token_audit.get("manifestSHA256")==MANIFEST_SHA256 and token_audit.get("integritySuccess") is True and
                token_audit.get("errors")==[],"Tokenizer audit did not pass")
        require(token_audit.get("normalizedRecordsSHA256")==sha256(canonical_json(token_audit.get("records"))),"Tokenizer retained-record digest differs")
        validate_tokenizer(token_audit["records"],manifest)
        require(len(records["START"])==1,"Missing or duplicate START")
        validate_start(records["START"][0],manifest)
        require(len(records["TRIAL"])<=72,"Too many trial rows")
        seen=set()
        for index,row in enumerate(records["TRIAL"]):
            try:
                validate_trial(row,manifest["trials"][index])
                if row["requestId"] is not None:
                    normalized=row["requestId"].lower()
                    require(normalized not in seen,"Duplicate request UUID")
                    seen.add(normalized)
                valid.append(row)
            except (EvidenceError,UnicodeError,ValueError,TypeError) as error:
                errors.append(f"trial {index+1}: {error}")
        require(len(records["TRIAL"])==72,"Missing trial rows; no completion is invented")
        require(len(valid)==72,"Invalid trial evidence")
        require(all(row["status"]!="notRunBudget" for row in valid),"Budget-unstarted rows prevent complete measurement")
        require(len(seen)==72,"Not all 72 requests were attempted distinctly")
        require(sequence==["START"]+["TRIAL"]*72+["SUMMARY"],"Marker order or count differs")
        require(len(records["SUMMARY"])==1,"Missing or duplicate SUMMARY")
        validate_summary(records["SUMMARY"][0],records["TRIAL"])
    except (OSError,EvidenceError,KeyError,TypeError,ValueError,UnicodeError) as error:
        errors.append(str(error))
    metrics=compute_metrics(valid)
    chat=metrics["perFormat"]["chat"]
    integrity=not errors
    feasible=integrity and chat["completedCount"]==36 and chat["strictValidAnswerCount"]==36 and chat["generationFailedCount"]==0
    audit={"reportKind":"recipient-format-calibration-audit","schemaVersion":1,
           "manifestSHA256":MANIFEST_SHA256,"modelSHA256":MODEL_SHA256,"llamaCppPinCommit":LLAMA_COMMIT,
           "tokenizerAuditSHA256":tokenizer_digest,"capture":capture,"integritySuccess":integrity,
           "chatFormatFeasible":feasible,"errors":errors,"metrics":metrics,
           "metricsAreCompleteMeasurement":integrity,
           "evidenceBoundary":{"sourceAuthenticationVerified":False,"modelExecutionIndependentlyVerified":False,
                               "originalV1AcceptanceChanged":False,"inferencePerformedByVerifier":False,
                               "qualityGateApplied":False,
                               "note":"Ordinary generation errors are retained negative data; source provenance and runner exit status are separate workflow gates. Partial metrics retain fixed denominators and do not substitute unpaired observations."}}
    atomic_write(output/"audit.json",encoded_json(audit))
    return audit


def gate(audit_path):
    audit=load_json(audit_path)
    require(isinstance(audit,dict) and exact(audit.get("schemaVersion"),1) and audit.get("reportKind")=="recipient-format-calibration-audit" and
            audit.get("manifestSHA256")==MANIFEST_SHA256 and audit.get("integritySuccess") is True and
            audit.get("chatFormatFeasible") is True and audit.get("errors")==[],"Chat-format feasibility gate failed")
    metrics=audit.get("metrics")
    require(isinstance(metrics,dict) and isinstance(metrics.get("perFormat"),dict),"Chat-format audit metrics missing")
    chat=metrics["perFormat"].get("chat")
    require(isinstance(chat,dict),"Chat-format audit metrics missing")
    require(exact(chat.get("completedCount"),36) and exact(chat.get("strictValidAnswerCount"),36) and
            exact(chat.get("generationFailedCount"),0) and exact(chat.get("unverifiedOrMissingRows"),0),"Chat-format audit metrics do not support feasibility")


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest="command",required=True)
    prep=commands.add_parser("prepare")
    for name in ("manifest","metadata","model","output"):
        prep.add_argument("--"+name,type=Path,required=True)
    tok=commands.add_parser("tokenizer")
    for name in ("manifest","input","output"):
        tok.add_argument("--"+name,type=Path,required=True)
    ver=commands.add_parser("verify")
    for name in ("manifest","log","tokenizer","output"):
        ver.add_argument("--"+name,type=Path,required=True)
    final=commands.add_parser("gate");final.add_argument("--audit",type=Path,required=True)
    args=parser.parse_args(argv)
    try:
        if args.command=="prepare":
            prepare(args.manifest,args.metadata,args.model,args.output)
        elif args.command=="tokenizer":
            return 0 if tokenizer(args.manifest,args.input,args.output)["integritySuccess"] else 1
        elif args.command=="verify":
            return 0 if verify(args.manifest,args.log,args.tokenizer,args.output)["integritySuccess"] else 1
        else:
            gate(args.audit)
    except (OSError,EvidenceError,KeyError,TypeError,UnicodeError,ValueError) as error:
        print("Recipient format calibration: "+str(error),file=sys.stderr)
        return 2
    return 0


if __name__=="__main__":
    raise SystemExit(main())
