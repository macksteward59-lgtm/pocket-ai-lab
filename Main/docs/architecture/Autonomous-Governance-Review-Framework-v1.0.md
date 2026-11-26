# Autonomous Governance Review Framework v1.0

**Status:** Engineering specification  
**Date:** 2026-11-10

This framework parses operator-supplied scanner exports, decides scope from an allowlist, and returns remediation text. It does not probe targets, generate exploits, mint tokens, or set `authorized`.

## Flow

```
scanner export (file)
  -> TelemetryWatcher (local directory)
  -> POST /api/v1/governance/review on 127.0.0.1
  -> parser (Burp XML via defusedxml, Nessus CSV, ZAP JSON/XML)
  -> TargetAllowlistPolicy
  -> REVIEW_READY or REJECTED
  -> PolicyChecker publishes SecurityBoundaryViolation
  -> existing TeamExpansionPlanner expands only in-scope reviews
  -> EvidenceSynthesizer + AuditLedger + ContextIngester
```

Humans reproduce anything outside this pipeline. Model and scanner text stay untrusted.

## State machine

`TELEMETRY_INGESTED` → `SCOPE_EVALUATED` → `REVIEW_READY` or `REJECTED`.

`REVIEW_READY` is legal only when `finding.asset.is_in_scope` is true. Parsers always leave `is_in_scope` false. Only the operator allowlist can set it true. An empty allowlist matches nothing.

Out-of-scope findings are dropped from the package and recorded as `SecurityBoundaryViolation` events. They do not spawn specialists.

## Existing intelligence layer

`main` at `1b62b87` already contains the security research agency (PR #28), llama.cpp chat context and `memory/relevance.ts` (PR #31), and the iOS Metal slice (PR #32). This framework extends those pieces:

- `TeamExpansionPlanner.expandForInScopeReview` calls the existing `expandTeam`. It does not define a second planner or a new specialist template.
- `dynamicCatalog.ts` keeps `DYNAMIC_SPECIALIST_CATALOG` and prepends the non-executing advisory invariant to prompts.
- `Orchestrator.handleScanTelemetryUpload` is an added method. The existing constructor, security division, and chat-context fields stay in place.
- `ContextIngester` writes through `MemoryManager` and ranks with `MemoryManager.search` (`relevance.ts`). New memory stays unverified.
- `packages/intelligence/index.ts` only appends exports, so a later serverless export addition can land beside them.

The advisory invariant is:

> You are a non-executing, passive governance advisory agent. You are forbidden from drafting working exploit tools, weaponized scripts, or execution payloads. Your sole objective is to analyze threat metadata and provide structured remediation documentation.

## Evidence

`EvidenceSynthesizer` writes markdown with these headers:

- `# Governance Evidence Report`
- `## Fingerprint`
- `## Authorization`
- `## Findings`
- `### Remediation checklist`
- `## Boundary`

The fingerprint is SHA-256 of the canonical finding body. `authorized` is false. `requiresHumanApproval` is true.

`AuditLedger` appends JSONL. Each line stores `prevHash` and a SHA-256 over the previous hash plus the payload. The first previous hash is 64 zeroes.

## Boundaries

- The sidecar binds to loopback. A non-loopback host is refused.
- Policy blobs use Fernet. Any other cipher, including XOR, is rejected.
- Burp XML is parsed with `defusedxml`. Malformed Burp, Nessus, and ZAP input returns no findings and does not raise.
- `packages/director/src/lib/apex/trust.ts` is not edited. It remains the placeholder.
- `apps/web/` is not edited. The viewer is `scripts/desktop/governance-dashboard/`.
- Static analysis and the parameter checklist do not execute source and do not emit payloads.

`authorized` stays false on packages, violations, evidence, ledger entries, health, and the desktop archive manifest.
