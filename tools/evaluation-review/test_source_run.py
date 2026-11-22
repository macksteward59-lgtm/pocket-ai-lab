import hashlib
import json
import unittest
from uuid import uuid4

from source_run import FORMAT, PASSAGE_SUITE, REFERENCE, review_run


class RunReviewTests(unittest.TestCase):
    def setUp(self):
        self.suite = json.loads(PASSAGE_SUITE.read_bytes())
        self.run = str(uuid4()).upper()
        self.model = json.loads(REFERENCE.read_bytes())["modelSHA256"]
        self.attempts = [dict(suiteID=self.suite["suiteID"], suiteVersion=self.suite["version"],
            caseID=c["id"], maxTokens=self.suite["maxTokens"], prompt=c["prompt"], scoringRule="exactMatch",
            status="completed", output=c["expected"], sourceRunID=self.run, requestID=str(uuid4()),
            runtimeSessionID="fixture", modelArtifactSHA256=self.model, providerKind="unverifiedProvider",
            nativeExecutionObserved=False, resourceSamples=dict(environment="iosSimulator", osVersion="fixture OS",
            sampleCount=3, intervalMilliseconds=250, lowPowerModeObserved=False, maxObservedFootprintBytes=120,
            worstObservedThermalState="fair")) for c in self.suite["cases"]]

    def packet(self):
        events = []
        prev = "GENESIS"
        for i, attempt in enumerate(self.attempts, 1):
            identity = str(uuid4())
            payload = json.dumps(dict(kind="attempt", attempt=attempt))
            h = hashlib.sha256(f"{i}\n{identity}\n{prev}\n{payload}".encode()).hexdigest()
            events.append(dict(format="pocket-ai-lab.evaluation-attempt.v1", eventID=identity, sequence=i,
                               previousHash=prev, payloadJSON=payload, eventHash=h))
            prev = h
        h = hashlib.sha256("\n".join([FORMAT, self.run, *(e["eventHash"] for e in events)]).encode()).hexdigest()
        return json.dumps(dict(format=FORMAT, runID=self.run, events=events, runSHA256=h)).encode(), h

    def test_complete_session_keeps_provider_identity_and_missing_observations(self):
        self.attempts[2].pop("resourceSamples")
        r = review_run(*self.packet())
        self.assertEqual((r["exactNativeAnswers"], r["hostedExactAnswers"], r["casesWithResourceSamples"]), (0, 3, 5))
        self.assertTrue(r["completeCaseSet"] and r["sameModelAsHostedReference"])
        self.assertEqual((r["maxObservedFootprintBytes"], r["minObservedHeadroomBytes"], r["worstObservedThermalState"]), (120, None, "fair"))
        self.assertFalse(r["hardwareVerified"])

    def test_incomplete_prefix_is_preserved(self):
        self.attempts.pop()
        result = review_run(*self.packet())
        self.assertEqual(result["recordedCases"], 5)
        self.assertFalse(result["completeCaseSet"])

    def test_distinct_run_session_model_or_case_order_is_rejected(self):
        for field, value in (("sourceRunID", str(uuid4()).upper()), ("runtimeSessionID", "different"),
                             ("modelArtifactSHA256", "a"*64), ("caseID", self.attempts[1]["caseID"])):
            old = self.attempts[0][field]
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.attempts[0][field] = value
                review_run(*self.packet())
            self.attempts[0][field] = old

    def test_wrong_separate_hash_and_changed_payload_are_rejected(self):
        packet, digest = self.packet()
        with self.assertRaises(ValueError):
            review_run(packet, "0" * 64)
        r = json.loads(packet)
        r["events"][0]["payloadJSON"] += " "
        with self.assertRaises(ValueError):
            review_run(json.dumps(r).encode(), digest)
