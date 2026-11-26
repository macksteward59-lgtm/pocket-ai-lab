"""Check a Pocket AI Lab native evaluation export against its separately recorded event digest."""
import argparse
import hashlib
import json
from pathlib import Path
import re
from uuid import UUID

MAX_BYTES = 2 * 1024 * 1024
SHA256 = re.compile(r"[0-9a-f]{64}")


def unique_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Repeated JSON field")
        result[key] = value
    return result


def verify(data, expected_hash, expected_answer=None):
    if len(data) > MAX_BYTES or not SHA256.fullmatch(expected_hash):
        raise ValueError("Invalid file size or expected SHA-256")
    record = json.loads(data.decode("utf-8"), object_pairs_hook=unique_fields)
    if not isinstance(record, dict) or record.get("format") != "pocket-ai-lab.evaluation-attempt.v1":
        raise ValueError("Unknown export format")
    sequence, event_id, previous, payload = (record[key] for key in ("sequence", "eventID", "previousHash", "payloadJSON"))
    if type(sequence) is not int or not 1 <= sequence <= 2**63 - 1:
        raise ValueError("Invalid journal sequence")
    if not isinstance(event_id, str) or str(UUID(event_id)).lower() != event_id.lower():
        raise ValueError("Invalid event identity")
    if not isinstance(previous, str) or not (previous == "GENESIS" if sequence == 1 else SHA256.fullmatch(previous)):
        raise ValueError("Invalid preceding digest")
    if not isinstance(payload, str):
        raise ValueError("Invalid payload encoding")
    digest = hashlib.sha256(f"{sequence}\n{event_id}\n{previous}\n{payload}".encode()).hexdigest()
    if digest != expected_hash or digest != record.get("eventHash"):
        raise ValueError("Export does not match the separately recorded event digest")
    decoded = json.loads(payload, object_pairs_hook=unique_fields)
    if not isinstance(decoded, dict) or decoded.get("kind") != "attempt" or not isinstance(decoded.get("attempt"), dict):
        raise ValueError("Expected one evaluation attempt")
    result = {"matchedEventSHA256": digest, "sequence": sequence, "eventID": event_id}
    if expected_answer is not None:
        prompt, output = expected_answer
        attempt = decoded["attempt"]
        if attempt.get("status") != "completed" or attempt.get("errorMessage") is not None:
            raise ValueError("The selected attempt did not complete successfully")
        if attempt.get("prompt") != prompt or attempt.get("output") != output:
            raise ValueError("The recorded prompt or output differs from the supplied answer check")
        result["completedAnswerMatches"] = True
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("--expected-event-hash", required=True)
    parser.add_argument("--expect-answer", nargs=2, metavar=("PROMPT", "OUTPUT"),
                        help="Also check a completed attempt against the supplied literal prompt and output")
    args = parser.parse_args()
    try:
        with args.file.open("rb") as stream:
            result = verify(stream.read(MAX_BYTES + 1), args.expected_event_hash, args.expect_answer)
        print(json.dumps(result))
    except (OSError, ValueError, KeyError, TypeError, RecursionError) as error:
        parser.exit(1, f"Review failed: {error}\n")
