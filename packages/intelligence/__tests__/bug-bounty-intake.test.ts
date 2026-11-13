import { describe, expect, it } from "vitest";
import {
  capturePolicySnapshot,
  comparePolicySnapshots,
  MAX_POLICY_TEXT_BYTES,
  PolicyIntakeError,
  PolicyIntakeInput
} from "../bug-bounty/intake";

function intake(overrides: Partial<PolicyIntakeInput> = {}): PolicyIntakeInput {
  return {
    programId: "program-1",
    platform: "hackerone",
    sourceUrl: "https://hackerone.com/acme",
    retrievedAt: "2026-11-12T12:00:00Z",
    contentFormat: "text/markdown",
    policyText: "# Program rules\n\nOnly test listed assets.",
    ...overrides
  };
}

describe("bug bounty policy intake provenance", () => {
  it("captures exact policy text and stable SHA-256 content identity", () => {
    const first = capturePolicySnapshot(intake());
    const second = capturePolicySnapshot(intake({ retrievedAt: "2026-11-12T13:00:00Z" }));
    expect(first.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.snapshotId).toBe("sha256:" + first.contentSha256);
    expect(first.contentSha256).toBe(second.contentSha256);
    expect(first.contentBytes).toBe(Buffer.byteLength(first.policyText, "utf8"));
    expect(first.authorized).toBe(false);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("detects changed policy text and requests re-extraction", () => {
    const previous = capturePolicySnapshot(intake());
    const current = capturePolicySnapshot(intake({
      retrievedAt: "2026-11-13T12:00:00Z",
      policyText: "# Program rules\n\nOnly test listed assets. No automated scanning."
    }));
    const comparison = comparePolicySnapshots(previous, current);
    expect(comparison.status).toBe("changed");
    expect(comparison.contentChanged).toBe(true);
    expect(comparison.authorized).toBe(false);
  });

  it("recognizes identical text across later retrievals", () => {
    const previous = capturePolicySnapshot(intake());
    const current = capturePolicySnapshot(intake({ retrievedAt: "2026-11-13T12:00:00Z" }));
    expect(comparePolicySnapshots(previous, current).status).toBe("unchanged");
  });

  it("flags conflicting content with the same retrieval timestamp", () => {
    const previous = capturePolicySnapshot(intake());
    const current = capturePolicySnapshot(intake({ policyText: "Different text at same timestamp" }));
    expect(comparePolicySnapshots(previous, current).status).toBe("timestamp-conflict");
  });

  it("flags out-of-order retrievals instead of silently promoting them", () => {
    const previous = capturePolicySnapshot(intake({ retrievedAt: "2026-11-13T12:00:00Z" }));
    const current = capturePolicySnapshot(intake({ retrievedAt: "2026-11-12T12:00:00Z" }));
    expect(comparePolicySnapshots(previous, current).status).toBe("out-of-order");
  });

  it("refuses to compare different programs or sources", () => {
    const previous = capturePolicySnapshot(intake());
    const otherProgram = capturePolicySnapshot(intake({ programId: "program-2" }));
    const otherSource = capturePolicySnapshot(intake({ sourceUrl: "https://hackerone.com/other" }));
    expect(() => comparePolicySnapshots(previous, otherProgram)).toThrow(PolicyIntakeError);
    expect(() => comparePolicySnapshots(previous, otherSource)).toThrow(PolicyIntakeError);
  });

  it("rejects non-HTTPS and credential-bearing source URLs", () => {
    expect(() => capturePolicySnapshot(intake({ sourceUrl: "http://hackerone.com/acme" })))
      .toThrow(PolicyIntakeError);
    expect(() => capturePolicySnapshot(intake({ sourceUrl: "https://user:pass@hackerone.com/acme" })))
      .toThrow(PolicyIntakeError);
  });

  it("rejects malformed timestamps, empty text, and null bytes", () => {
    expect(() => capturePolicySnapshot(intake({ retrievedAt: "today" }))).toThrow(PolicyIntakeError);
    expect(() => capturePolicySnapshot(intake({ retrievedAt: "2026-02-31T12:00:00Z" }))).toThrow(PolicyIntakeError);
    expect(() => capturePolicySnapshot(intake({ retrievedAt: "2026-11-12T25:00:00Z" }))).toThrow(PolicyIntakeError);
    expect(() => capturePolicySnapshot(intake({ policyText: "  " }))).toThrow(PolicyIntakeError);
    expect(() => capturePolicySnapshot(intake({ policyText: "rules\u0000hidden" }))).toThrow(PolicyIntakeError);
  });

  it("rejects unpaired UTF-16 surrogates before hashing", () => {
    expect(() => capturePolicySnapshot(intake({ policyText: "rules\uD800" })))
      .toThrow(PolicyIntakeError);
    expect(() => capturePolicySnapshot(intake({ policyText: "rules\uDC00" })))
      .toThrow(PolicyIntakeError);
    expect(() => capturePolicySnapshot(intake({ policyText: "rules 😀" })))
      .not.toThrow();
  });

  it("enforces a bounded policy text size", () => {
    expect(() => capturePolicySnapshot(intake({ policyText: "x".repeat(MAX_POLICY_TEXT_BYTES + 1) })))
      .toThrow(PolicyIntakeError);
  });

  it("does not let snapshot intake or comparison grant authority", () => {
    const previous = capturePolicySnapshot(intake());
    const current = capturePolicySnapshot(intake({ policyText: "Updated policy" }));
    const comparison = comparePolicySnapshots(previous, current);
    expect(previous.authorized).toBe(false);
    expect(current.authorized).toBe(false);
    expect(comparison.authorized).toBe(false);
  });
});
