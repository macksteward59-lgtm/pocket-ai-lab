"""Synthetic evidence-contract tests only: no tokenizer, model or inference runs.

The fabricated token IDs and llamaCpp-labelled JSON below exercise validation.
They are explicitly marked SYNTHETIC FIXTURE ONLY in every simulated native log
and must never be reported as actual native/model execution evidence.
"""

import base64
import contextlib
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import uuid

import recipient_format_calibration as calibration


MANIFEST = Path(__file__).resolve().parents[1] / "Tests/LlamaEngineTests/Fixtures/recipient-format-calibration-v1.json"
SYNTHETIC_LABEL = "SYNTHETIC FIXTURE ONLY; no native tokenization or model execution\n"


def synthetic_tokenizer(manifest):
    """Invented token records, not an actual tokenization of any prompt."""
    records=[{"recordType":"start","schemaVersion":1,"mode":"vocab-only","inferencePerformed":False,
              "contextCreated":False,"requestedPromptCount":72,"maximumPromptBytes":1024,"maximumTokens":4096,
              "llamaCppPinTag":calibration.LLAMA_TAG,"llamaCppPinCommit":calibration.LLAMA_COMMIT}]
    template=manifest["template"]["text"].encode("utf-8")
    markers=[{"spelling":spelling,"tokenID":identifier,"attributes":4,"isEOG":identifier==2,
              "isolatedAddSpecial":False,"parseSpecialTrueTokenIDs":[identifier],
              "parseSpecialFalseTokenIDs":[100,101]} for spelling,identifier in
             [("<|im_start|>",1),("<|im_end|>",2),("<|endoftext|>",0)]]
    records.append({"recordType":"vocabulary","vocabularySize":49152,"effectiveAddBOS":False,
                    "effectiveAddEOS":False,"bosTokenID":1,"eosTokenID":2,"templateByteCount":len(template),
                    "templateUTF8Hex":template.hex(),"markers":markers})
    for row in manifest["trials"]:
        prompt=row["prompt"].encode("ascii")
        tokens=[100,101] if row["format"]=="raw" else [1,100,2,1,101,2,1]
        records.append({"recordType":"prompt","ordinal":row["ordinal"],"promptByteCount":len(prompt),
                        "promptASCII":row["prompt"],"addSpecial":True,"parseSpecial":True,"tokenCount":len(tokens),
                        "tokenIDs":tokens,"detokenizeRemoveSpecial":False,"detokenizeUnparseSpecial":True,
                        "detokenizedByteCount":len(prompt),"detokenizedUTF8Hex":prompt.hex()})
    records.append({"recordType":"summary","status":"completed","processedPromptCount":72,
                    "inferencePerformed":False,"contextCreated":False})
    return records


def synthetic_measurement(manifest):
    start={"schemaVersion":1,"manifestSHA256":calibration.MANIFEST_SHA256,
           "modelArtifactSHA256":calibration.MODEL_SHA256,"modelBytes":calibration.MODEL_BYTES,
           "modelId":"sha256-"+calibration.MODEL_SHA256,"providerKind":"llamaCpp",
           "contextLength":512,"maxTokens":4,"temperature":0,"maxOutputBytes":128,"maximumDurationSeconds":900,
           "llamaCppPinTag":calibration.LLAMA_TAG,"llamaCppPinCommit":calibration.LLAMA_COMMIT,
           "offload":{"metalDeviceUsableAtLoad":False,"requestedGpuLayers":0,"offloadedLayers":0,"reportedLayerCount":31}}
    rows=[]
    for expected in manifest["trials"]:
        row={name:expected[name] for name in ("ordinal","sourceTrialOrdinal","caseId","condition","format","promptSHA256","expectedAnswer")}
        # Every raw reply is invalid. Every chat reply is valid but uniformly A,
        # making the format success intentionally independent of answer quality.
        output="invalid" if expected["format"]=="raw" else "A"
        parsed=calibration.parse_answer(output)
        row.update(requestId=str(uuid.uuid4()).upper(),rawOutput=output,status="completed",parsedAnswer=parsed,
                   scoredCorrect=parsed==expected["expectedAnswer"],errorMessage=None,latencyMilliseconds=1)
        rows.append(row)
    cleanup={"leaseReleased":True,"activeLeaseCountBeforeRelease":1,"activeUseCountBeforeRelease":0,
             "activeRequestsBeforeRelease":0,"waitingRequestsBeforeRelease":0,"activeLeaseCount":0,"activeUseCount":0,
             "loadedModelIDs":[],"pendingModelIDs":[],"unloadingModelIDs":[],"reservedMemoryMB":0,
             "activeRequests":0,"waitingRequests":0}
    summary={"manifestSHA256":calibration.MANIFEST_SHA256,"status":"completed","elapsedMilliseconds":100,
             "modelArtifactSHA256After":calibration.MODEL_SHA256,"modelBytesAfter":calibration.MODEL_BYTES,
             "trials":copy.deepcopy(rows),"cleanup":cleanup}
    return start,rows,summary


class SyntheticEvidenceContractTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(prefix="synthetic-format-fixtures-")
        self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name)
        self.manifest,_=calibration.load_manifest(MANIFEST)
        self.tokens=synthetic_tokenizer(self.manifest)
        self.token_input=self.root/"synthetic-tokenizer.jsonl"
        self.token_audit=self.root/"synthetic-tokenizer-audit.json"
        self.write_tokens()
        self.assertTrue(calibration.tokenizer(MANIFEST,self.token_input,self.token_audit)["integritySuccess"])
        self.start,self.rows,self.summary=synthetic_measurement(self.manifest)
        self.log=self.root/"synthetic-fixture.log"
        self.output=self.root/"synthetic-audit"

    def write_tokens(self):
        self.token_input.write_bytes(b"".join(calibration.canonical_json(row)+b"\n" for row in self.tokens))

    def run_tokens(self):
        self.write_tokens()
        return calibration.tokenizer(MANIFEST,self.token_input,self.token_audit)

    def write_log(self, include_summary=True, update_summary=True):
        if update_summary:
            self.summary["trials"]=copy.deepcopy(self.rows)
        lines=[SYNTHETIC_LABEL,"POCKET_RECIPIENT_FORMAT_START "+json.dumps(self.start)+"\n"]
        lines.extend("POCKET_RECIPIENT_FORMAT_TRIAL "+json.dumps(row)+"\n" for row in self.rows)
        if include_summary:
            lines.append("POCKET_RECIPIENT_FORMAT_SUMMARY "+json.dumps(self.summary)+"\n")
        self.log.write_text("".join(lines))

    def verify(self, **kwargs):
        self.write_log(**kwargs)
        return calibration.verify(MANIFEST,self.log,self.token_audit,self.output)

    def assert_integrity_fails(self, **kwargs):
        audit=self.verify(**kwargs)
        self.assertFalse(audit["integritySuccess"])
        self.assertFalse(audit["chatFormatFeasible"])
        self.assertTrue(audit["errors"])
        self.assertTrue((self.output/"audit.json").exists())
        return audit

    def failed_row(self, index):
        self.rows[index].update(status="generationFailed",rawOutput=None,parsedAnswer=None,scoredCorrect=False,
                                errorMessage='backendFailed("llama.cpp returned empty text. No token was invented.")')

    def metadata(self):
        template=self.manifest["template"]
        return {"schemaVersion":1,"probe":"pinned-gguf-recipient-template-metadata",
                "verifiedModel":{"bytes":calibration.MODEL_BYTES,"sha256":calibration.MODEL_SHA256},
                "chatTemplate":{"text":template["text"],"sha256":template["sha256"],
                                "utf8ByteLength":template["utf8ByteLength"],
                                "utf8Base64":base64.b64encode(template["text"].encode()).decode()},
                "tokenizerMetadata":{"tokenizer.ggml.model":"gpt2","tokenizer.ggml.pre":"smollm",
                                     "tokenizer.ggml.add_bos_token":False,"tokenizer.ggml.add_space_prefix":False},
                "evidenceBoundary":{name:False for name in ("templateRendered","tokenizationExecuted","inferenceExecuted",
                                                            "runtimeDefaultFlagsInferred","recipientQualityEstablished")}}

    def test_frozen_manifest_digest_and_schedule(self):
        self.assertEqual(hashlib.sha256(MANIFEST.read_bytes()).hexdigest(),calibration.MANIFEST_SHA256)
        self.assertEqual(len(MANIFEST.read_bytes()),44072)
        self.assertEqual(len(self.manifest["trials"]),72)

    def test_format_success_is_separate_from_quality(self):
        audit=self.verify()
        self.assertTrue(audit["integritySuccess"])
        self.assertTrue(audit["chatFormatFeasible"])
        self.assertTrue(audit["capture"]["syntheticFixtureLabelPresent"])
        self.assertFalse(audit["evidenceBoundary"]["modelExecutionIndependentlyVerified"])
        metrics=audit["metrics"]["perFormat"]
        self.assertEqual(metrics["raw"]["invalidAnswerCount"],36)
        self.assertEqual(metrics["chat"]["strictValidAnswerCount"],36)
        self.assertEqual(metrics["chat"]["intendedCounterfactualSwitchCount"],0)
        self.assertEqual(metrics["chat"]["conditions"]["correct"]["correctAnswerCount"],6)
        calibration.gate(self.output/"audit.json")

    def test_generation_failure_is_retained_negative_data(self):
        self.failed_row(0)
        audit=self.verify()
        self.assertTrue(audit["integritySuccess"])
        self.assertTrue(audit["chatFormatFeasible"])
        self.assertEqual(audit["metrics"]["perFormat"]["raw"]["generationFailedCount"],1)
        captured=json.loads((self.output/"trial.jsonl").read_text().splitlines()[0])
        self.assertIn("rawOutput",captured)
        self.assertIsNone(captured["rawOutput"])

    def test_chat_generation_error_fails_only_separate_format_gate(self):
        self.failed_row(1)
        audit=self.verify()
        self.assertTrue(audit["integritySuccess"])
        self.assertFalse(audit["chatFormatFeasible"])
        with self.assertRaises(calibration.EvidenceError):calibration.gate(self.output/"audit.json")

    def test_chat_invalid_answer_fails_separate_gate(self):
        self.rows[1].update(rawOutput="A\u00a0",parsedAnswer=None,scoredCorrect=False)
        audit=self.verify()
        self.assertTrue(audit["integritySuccess"])
        self.assertFalse(audit["chatFormatFeasible"])

    def test_missing_null_field_cannot_pass_as_explicit_null(self):
        del self.rows[0]["errorMessage"]
        self.assert_integrity_fails()

    def test_failure_with_nonnull_output_is_rejected(self):
        self.failed_row(0);self.rows[0]["rawOutput"]=""
        self.assert_integrity_fails()

    def test_completed_null_or_blank_output_is_not_fabricated(self):
        self.rows[0].update(rawOutput=None,parsedAnswer=None,scoredCorrect=False)
        self.assert_integrity_fails()

    def test_cancellation_error_cannot_be_ordinary_measurement(self):
        self.failed_row(0);self.rows[0]["errorMessage"]="CancellationError()"
        self.assert_integrity_fails()

    def test_bare_pool_lease_error_is_not_ordinary_generation_data(self):
        self.failed_row(0);self.rows[0]["errorMessage"]="invalidLease"
        self.assert_integrity_fails()

    def test_independent_pair_counts_and_intended_switches(self):
        # Predetermined extreme case: raw follows correct/counterfactual only;
        # chat answers only absent cases correctly. All 72 answers are valid.
        for row in self.rows:
            succeeds = (row["condition"]!="absent") if row["format"]=="raw" else (row["condition"]=="absent")
            answer=row["expectedAnswer"] if succeeds else ("B" if row["expectedAnswer"]=="A" else "A")
            row.update(rawOutput=answer,parsedAnswer=answer,scoredCorrect=succeeds)
        audit=self.verify()
        self.assertTrue(audit["integritySuccess"])
        self.assertTrue(audit["chatFormatFeasible"])
        metrics=audit["metrics"];raw=metrics["perFormat"]["raw"];chat=metrics["perFormat"]["chat"]
        self.assertEqual(raw["intendedCounterfactualSwitchCount"],12)
        self.assertEqual(chat["intendedCounterfactualSwitchCount"],0)
        self.assertEqual(raw["correctMinusAbsentAccuracy"],1)
        self.assertEqual(chat["correctMinusAbsentAccuracy"],-1)
        self.assertEqual(metrics["pairedFormatsByCondition"]["correct"]["rawOnlyCorrect"],12)
        self.assertEqual(metrics["pairedFormatsByCondition"]["absent"]["chatOnlyCorrect"],12)
        self.assertEqual(metrics["pairedFormatsByCondition"]["counterfactual"]["chatMinusRawAccuracy"],-1)

    def test_bool_is_not_an_integer(self):
        self.rows[0]["latencyMilliseconds"]=True
        self.assert_integrity_fails()

    def test_wrong_prompt_digest_rejected(self):
        self.rows[0]["promptSHA256"]="0"*64
        self.assert_integrity_fails()

    def test_swapped_rows_rejected(self):
        self.rows[0],self.rows[1]=self.rows[1],self.rows[0]
        self.assert_integrity_fails()

    def test_duplicate_uuid_case_insensitive_rejected(self):
        self.rows[1]["requestId"]=self.rows[0]["requestId"].lower()
        self.assert_integrity_fails()

    def test_fake_provider_rejected(self):
        self.start["providerKind"]="fixture"
        self.assert_integrity_fails()

    def test_after_model_digest_rejected(self):
        self.summary["modelArtifactSHA256After"]="0"*64
        self.assert_integrity_fails()

    def test_cleanup_incomplete_rejected(self):
        self.summary["cleanup"]["loadedModelIDs"]=["still-loaded"]
        self.assert_integrity_fails()

    def test_cleanup_boolean_cannot_equal_zero(self):
        self.summary["cleanup"]["activeUseCount"]=False
        self.assert_integrity_fails()

    def test_summary_float_ordinal_cannot_equal_integer(self):
        self.summary["trials"][0]["ordinal"]=1.0
        self.assert_integrity_fails(update_summary=False)

    def test_impossible_sum_of_durations_rejected(self):
        self.summary["elapsedMilliseconds"]=71
        self.assert_integrity_fails()

    def test_budget_expiry_not_accepted(self):
        self.rows[-1].update(status="notRunBudget",requestId=None,rawOutput=None,parsedAnswer=None,scoredCorrect=False,
                             errorMessage="The frozen between-request budget expired.",latencyMilliseconds=0)
        self.summary["status"]="budgetExceeded"
        audit=self.assert_integrity_fails()
        self.assertEqual(sum(m["notRunBudgetCount"] for m in audit["metrics"]["perFormat"].values()),1)

    def test_partial_capture_keeps_observations_without_completion(self):
        self.rows=self.rows[:5]
        audit=self.assert_integrity_fails(include_summary=False)
        self.assertEqual(audit["capture"]["recordCounts"],{"START":1,"TRIAL":5,"SUMMARY":0})
        self.assertEqual(len((self.output/"trial.jsonl").read_text().splitlines()),5)
        self.assertEqual(sum(m["unverifiedOrMissingRows"] for m in audit["metrics"]["perFormat"].values()),67)
        self.assertEqual(audit["metrics"]["pairedFormatsByCondition"]["counterfactual"]["observedPairs"],0)

    def test_duplicate_json_and_nonfinite_rejected(self):
        for raw in (b'{"x":1,"x":2}',b'{"outer":{"x":1,"x":2}}',b'{"x":NaN}',b'{"x":Infinity}',b'{"x":1e999}'):
            with self.subTest(raw=raw),self.assertRaises(calibration.EvidenceError):calibration.strict_json(raw)

    def test_malformed_marker_preserved_before_integrity_failure(self):
        self.write_log()
        with self.log.open("a") as out:out.write('POCKET_RECIPIENT_FORMAT_TRIAL {"bad":NaN}\n')
        audit=calibration.verify(MANIFEST,self.log,self.token_audit,self.output)
        self.assertFalse(audit["integritySuccess"])
        self.assertIn(b'"bad":NaN',(self.output/"raw-markers.log").read_bytes())
        self.assertEqual(len((self.output/"trial.jsonl").read_text().splitlines()),72)

    def test_large_log_line_is_bounded_and_failure_audit_saved(self):
        self.log.write_bytes(b"x"*(calibration.MAX_LINE_BYTES+1))
        audit=calibration.verify(MANIFEST,self.log,self.token_audit,self.output)
        self.assertFalse(audit["integritySuccess"])
        self.assertTrue((self.output/"audit.json").is_file())

    def test_manifest_tamper_rejected(self):
        path=self.root/"tampered-manifest.json";path.write_bytes(MANIFEST.read_bytes()+b"\n")
        with self.assertRaises(calibration.EvidenceError):calibration.load_manifest(path)

    def test_tokenizer_template_or_switch_tamper(self):
        self.tokens[1]["effectiveAddEOS"]=True
        audit=self.run_tokens()
        self.assertFalse(audit["integritySuccess"])
        self.assertTrue(self.token_audit.exists())

    def test_tokenizer_marker_parse_must_differ(self):
        self.tokens[1]["markers"][0]["parseSpecialFalseTokenIDs"]=[1]
        self.assertFalse(self.run_tokens()["integritySuccess"])

    def test_tokenizer_bool_token_id_rejected(self):
        self.tokens[3]["tokenIDs"][0]=True
        self.assertFalse(self.run_tokens()["integritySuccess"])

    def test_tokenizer_detokenized_bytes_must_match_exactly(self):
        self.tokens[2]["detokenizedUTF8Hex"]="00"
        self.assertFalse(self.run_tokens()["integritySuccess"])

    def test_tokenizer_context_must_allow_four_generated_tokens(self):
        self.tokens[2]["tokenIDs"]=[100]*509;self.tokens[2]["tokenCount"]=509
        self.assertFalse(self.run_tokens()["integritySuccess"])

    def test_tokenizer_partial_report_is_saved_as_failure(self):
        self.tokens=self.tokens[:7]
        audit=self.run_tokens()
        self.assertFalse(audit["integritySuccess"])
        self.assertEqual(len(audit["records"]),7)

    def test_tokenizer_audit_boolean_cannot_bypass_record_revalidation(self):
        audit=json.loads(self.token_audit.read_text())
        audit["records"][1]["effectiveAddEOS"]=True
        audit["normalizedRecordsSHA256"]=calibration.sha256(calibration.canonical_json(audit["records"]))
        self.token_audit.write_text(json.dumps(audit))
        self.assert_integrity_fails()

    def test_tokenizer_audit_boolean_schema_is_rejected(self):
        audit=json.loads(self.token_audit.read_text());audit["schemaVersion"]=True
        self.token_audit.write_text(json.dumps(audit))
        self.assert_integrity_fails()

    def test_whole_file_hash_covers_bytes_beyond_prefix(self):
        path=self.root/"synthetic-model-bytes.bin";data=b"header"+b"x"*1000;path.write_bytes(data)
        calibration.verify_model_file(path,len(data),calibration.sha256(data))
        path.write_bytes(data[:-1]+b"y")
        with self.assertRaises(calibration.EvidenceError):calibration.verify_model_file(path,len(data),calibration.sha256(data))

    def test_prepare_copies_exact_frozen_prompts_without_running_a_template(self):
        metadata=self.root/"synthetic-metadata.json";metadata.write_text(json.dumps(self.metadata()))
        model=self.root/"synthetic-unverified-model.bin";model.write_bytes(b"synthetic fixture")
        output=self.root/"synthetic-prepared"
        # Only the model-byte validation is a declared test double. Its actual
        # streaming digest behavior is tested separately; no GGUF is executed.
        with mock.patch.object(calibration,"verify_model_file") as check:
            calibration.prepare(MANIFEST,metadata,model,output)
            check.assert_called_once_with(model,calibration.MODEL_BYTES,calibration.MODEL_SHA256)
        self.assertEqual((output/"manifest.json").read_bytes(),MANIFEST.read_bytes())
        self.assertEqual(len(list((output/"prompts").glob("*.txt"))),72)
        for row in self.manifest["trials"]:
            self.assertEqual((output/"prompts"/f'{row["ordinal"]:03}.txt').read_bytes(),row["prompt"].encode("ascii"))

    def test_prepare_bad_model_never_publishes_output(self):
        metadata=self.root/"synthetic-metadata.json";metadata.write_text(json.dumps(self.metadata()))
        model=self.root/"synthetic-short-model.bin";model.write_bytes(b"not the pinned model")
        output=self.root/"not-published"
        with self.assertRaises(calibration.EvidenceError):calibration.prepare(MANIFEST,metadata,model,output)
        self.assertFalse(output.exists())

    def test_prepare_metadata_template_mismatch_rejected(self):
        value=self.metadata();value["chatTemplate"]["text"]+="\n"
        with self.assertRaises(calibration.EvidenceError):calibration.validate_metadata(value,self.manifest)

    def test_prepare_malformed_metadata_container_rejected_cleanly(self):
        for name in ("evidenceBoundary","tokenizerMetadata"):
            value=self.metadata();value[name]=[]
            with self.subTest(name=name),self.assertRaises(calibration.EvidenceError):
                calibration.validate_metadata(value,self.manifest)

    def test_output_aliases_cannot_overwrite_input(self):
        original=self.token_input.read_bytes()
        with self.assertRaises(calibration.EvidenceError):calibration.tokenizer(MANIFEST,self.token_input,self.token_input)
        self.assertEqual(self.token_input.read_bytes(),original)
        alias=self.root/"alias.json";alias.hardlink_to(self.token_input)
        with self.assertRaises(calibration.EvidenceError):calibration.tokenizer(MANIFEST,self.token_input,alias)
        self.assertEqual(self.token_input.read_bytes(),original)

    def test_existing_verify_directory_not_overwritten(self):
        self.output.mkdir();(self.output/"keep").write_text("keep")
        self.write_log()
        with self.assertRaises(calibration.EvidenceError):calibration.verify(MANIFEST,self.log,self.token_audit,self.output)
        self.assertEqual((self.output/"keep").read_text(),"keep")

    def test_cli_verify_and_gate_have_distinct_exit_codes(self):
        self.failed_row(1);self.write_log()
        self.assertEqual(calibration.main(["verify","--manifest",str(MANIFEST),"--log",str(self.log),
                                           "--tokenizer",str(self.token_audit),"--output",str(self.output)]),0)
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertNotEqual(calibration.main(["gate","--audit",str(self.output/"audit.json")]),0)


if __name__=="__main__":
    unittest.main()
