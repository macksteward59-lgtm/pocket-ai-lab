/**
 * Host-only frozen inputs and lifecycle assertions for the UTF-8 warm-up.
 *
 * This module never executes candidate source or accepts a candidate's score.
 * Keep the fixture, especially heldOut and expected values, outside containers
 * and outside the model's revision context. The Docker host adapter grades
 * actual outputs independently.
 */
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const DEFAULT_FIXTURE_PATH = fileURLToPath(new URL("./utf8-prefix-v1.json", import.meta.url));
export const FROZEN_FIXTURE_SHA256 = "00b849a53254d1a28612b4d0bac2b15c24317a7c18af18fb36c52a27fe44ab6d";
export const FIXTURE_LIMITS = Object.freeze({
  maxInputBytes: 4096,
  maxByteLimit: 4096,
  maxRevisions: 2,
  maxManifestBytes: 64 * 1024
});

const BASELINE_SOURCE = "def truncate_utf8(text, byte_limit):\n    return text[:byte_limit]\n";
const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Read the exact v1 fixture and return a deeply immutable { fixture, digest }.
 * An alternate path may contain an exact copy, not a replacement benchmark.
 * A changed fixture needs a new version and independently reviewed digest.
 */
export async function loadFrozenFixture(path = DEFAULT_FIXTURE_PATH) {
  const bytes = await readBounded(path, FIXTURE_LIMITS.maxManifestBytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== FROZEN_FIXTURE_SHA256) {
    throw new Error("Frozen fixture digest mismatch; refusing a changed benchmark");
  }
  const fixture = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  validateManifest(fixture);
  return deepFreeze({ fixture, digest });
}

/**
 * Validate only the host-to-candidate input domain. No case IDs or answers
 * belong in this object. Invalid inputs are protocol failures, not score cases.
 */
export function assertFixtureInput(input) {
  exactKeys(input, ["text", "byteLimit"], "Fixture input");
  assertScalarString(input.text, "Fixture input text");
  if (Buffer.byteLength(input.text, "utf8") > FIXTURE_LIMITS.maxInputBytes) {
    throw new Error("Fixture input exceeds the UTF-8 byte limit");
  }
  if (!Number.isSafeInteger(input.byteLimit) || input.byteLimit < 0 ||
      input.byteLimit > FIXTURE_LIMITS.maxByteLimit) {
    throw new Error("byteLimit must be an integer from 0 through 4096");
  }
  return Object.freeze({ text: input.text, byteLimit: input.byteLimit });
}

/**
 * Check a real candidate selection before freezing it. A baseline-only run,
 * malformed digest, or expanded revision budget cannot enter held-out scoring.
 * The caller must hash the actual source bytes and preserve the attempt log.
 */
export function assertCandidateSelection(selection) {
  exactKeys(selection, ["revisionCount", "maxRevisions", "sourceDigest"], "Candidate selection");
  if (selection.maxRevisions !== FIXTURE_LIMITS.maxRevisions ||
      !Number.isSafeInteger(selection.revisionCount) || selection.revisionCount < 1 ||
      selection.revisionCount > selection.maxRevisions) {
    throw new Error("Candidate selection requires one or two revisions within the frozen budget");
  }
  assertDigest(selection.sourceDigest, "Candidate source digest");
  return Object.freeze({
    revisionCount: selection.revisionCount,
    maxRevisions: selection.maxRevisions,
    sourceDigest: selection.sourceDigest
  });
}

/**
 * Call immediately before held-out execution, using a freshly computed hash
 * of the candidate source. This is an in-process invariant, not an attestation.
 * Neither this function nor a passing score authorizes activation.
 */
export function assertHeldOutGate(gate) {
  exactKeys(
    gate,
    ["frozenSourceDigest", "candidateSourceDigest", "revisionCount", "maxRevisions"],
    "Held-out gate"
  );
  const selection = assertCandidateSelection({
    revisionCount: gate.revisionCount,
    maxRevisions: gate.maxRevisions,
    sourceDigest: gate.frozenSourceDigest
  });
  assertDigest(gate.candidateSourceDigest, "Current candidate source digest");
  if (gate.candidateSourceDigest !== gate.frozenSourceDigest) {
    throw new Error("Candidate changed after the final-source freeze");
  }
  return selection;
}

function validateManifest(fixture) {
  exactKeys(
    fixture,
    ["version", "taskSpec", "baselineSource", "maxRevisions", "development", "heldOut"],
    "Frozen fixture"
  );
  if (fixture.version !== 1 || fixture.maxRevisions !== FIXTURE_LIMITS.maxRevisions) {
    throw new Error("Unsupported fixture version or revision budget");
  }
  assertScalarString(fixture.taskSpec, "Task specification");
  if (!fixture.taskSpec.trim() || fixture.baselineSource !== BASELINE_SOURCE) {
    throw new Error("Missing task specification or unexpected baseline source");
  }
  if (!Array.isArray(fixture.development) || fixture.development.length !== 8 ||
      !Array.isArray(fixture.heldOut) || fixture.heldOut.length !== 20) {
    throw new Error("Frozen fixture must contain 8 development and 20 held-out cases");
  }
  const ids = new Set();
  for (const [suite, cases] of [["D", fixture.development], ["H", fixture.heldOut]]) {
    for (const item of cases) {
      exactKeys(item, ["id", "text", "byteLimit", "expected"], "Fixture case");
      if (typeof item.id !== "string" || !new RegExp("^" + suite + "[0-9]{2}$").test(item.id) ||
          ids.has(item.id)) {
        throw new Error("Fixture case has an invalid or duplicate ID");
      }
      ids.add(item.id);
      assertFixtureInput({ text: item.text, byteLimit: item.byteLimit });
      assertScalarString(item.expected, "Literal expected result");
      // Validate manually frozen constants; never derive an answer from a
      // candidate. This is fixture integrity checking, not execution grading.
      if (!item.text.startsWith(item.expected) ||
          Buffer.byteLength(item.expected, "utf8") > item.byteLimit) {
        throw new Error("Literal expected result is not a bounded prefix");
      }
      const suffix = item.text.slice(item.expected.length);
      if (suffix) {
        const nextCodePoint = String.fromCodePoint(suffix.codePointAt(0));
        if (Buffer.byteLength(item.expected + nextCodePoint, "utf8") <= item.byteLimit) {
          throw new Error("Literal expected prefix is not maximal");
        }
      }
    }
  }
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(label + " must be a lowercase SHA-256 digest");
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(label + " must be a plain object");
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(label + " contains missing or unexpected fields");
  }
}

function assertScalarString(value, label) {
  if (typeof value !== "string") throw new Error(label + " must be a string");
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(label + " contains an unpaired surrogate");
      }
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error(label + " contains an unpaired surrogate");
    }
  }
}

async function readBounded(path, limit) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > limit) throw new Error("Frozen fixture exceeds the manifest byte limit");
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
