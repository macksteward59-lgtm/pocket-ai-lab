# G.I.R.L. protocol v1 — exact-model compatibility gate

**Status:** Proposed security correction; no production routing, native recipient interpretation, physical device test, or approval. Parent is PR #218 (`codex/latent-channel-runtime-poc`).

## Reproduced gap

Before this correction, `negotiateLatentCodec` compared codec ID, version, dtype and payload limit but could return a selection between distinct model IDs/revisions. A direct `LatentTransferEnvelopeSchema` parse likewise accepted a cross-model pair. The existing affine-int8 single-model codec often rejected the pair later, but that adapter's behavior is not an authorization or protocol guarantee. An alternate codec that advertises both models could bypass that incidental protection. Tests previously expected heterogeneous negotiation to succeed.

## Invariant and change

Protocol **v1** must be same-model **and same immutable revision**, compared byte-for-byte. An identical codec ID or dimensionality is insufficient. The pure negotiator now returns `null` (ordinary text fallback at the caller), and the version-1 codec selection schema rejects independently supplied/forged cross-model metadata. No outgoing payload is stored when negotiation fails; incoming forged metadata is rejected before authorization/blobs/decoding. Host APEX authorization, task/routing constraints, replay protection and binary integrity remain required.

Future heterogeneous-model use must negotiate a **new** versioned, independently trained and held-out evaluated alignment protocol, not loosen v1. This correction does **not** add alignment, numerical recipient ingestion, a trained codebook, a live same-model agent step, or any cross-model semantic quality evidence.

## Focused validation

```sh
npm install
npx vitest run packages/intelligence/__tests__/latent-channel.test.ts packages/intelligence/__tests__/latent-channel-runtime.test.ts
```

Tests enforce same-model positive negotiation and exact-model negative cases; a forged envelope is rejected before a second authorization call or any blob read. An isolated CI job tests these source files without claiming the currently blocked whole-project East TypeScript build passed. The general CI outcome must be reported independently. This does not mark any global 343-item checklist requirement verified; it closes a narrower route-safety invariant in the v1 prototype only.

See `coordination/GIRL_GEOMETRIC_LATENT_INTEGRATION_2026-11-19.md` on `agent-coordination` for integrated sender/recipient acceptance gates and text fallback requirements.
