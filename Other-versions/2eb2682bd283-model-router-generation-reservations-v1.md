# Model Router Generation Reservations v1

## Problem

A model ID can outlive the artifact that originally occupied it. A runtime may also report a model ID as loaded after a plugin replacement, even though the loaded session still corresponds to the old path or descriptor. Replacing or removing a registry entry must not free memory accounting while an inference request is still using that exact model generation.

## Reservation contract

- \`route()\` returns the exact \`ModelDescriptor\` object generation that the caller must retain.
- Multiple requests using the same descriptor object share one memory reservation and increment its reference count.
- A different descriptor object with the same model ID cannot route while an earlier generation remains reserved.
- A descriptor fingerprint covers ID, name, path, context length, quantization, capabilities, and memory estimate. Mutating any of these fields while a lease is active is rejected.
- \`release(descriptor)\` releases only the exact descriptor generation returned by \`route()\`. It is safe to call from \`finally\`; duplicate or stale releases are no-ops.
- \`retire(modelId, descriptor)\` prevents new routes to the old descriptor and marks its reservations retired. Existing requests keep their references until they finish and release.
- A replacement with the same ID cannot route until the retired generation drains.
- The router records \`requiresFreshLoad\` after retirement. A stale \`loadedModels\` ID from the resource provider cannot bypass memory admission for the replacement.
- \`confirmLoaded(descriptor)\` clears that requirement only after the inference provider has successfully returned from generation for the exact descriptor.

## Required caller pattern

\`\`\`ts
const selected = await router.route(agentId, preferredModel, requiredCapabilities);
let sessionId: string | undefined;
try {
  sessionId = agents.startSession(agentId, taskId, selected.id);
  const result = await inference.generate({ agentId, modelId: selected.id, ...request });
  router.confirmLoaded(selected);
  return result;
} finally {
  if (sessionId) agents.releaseSession(sessionId);
  router.release(selected);
}
\`\`\`

The route lease must be released even if session creation, inference, validation, publication, or downstream processing throws. Confirmation happens only after the provider returns successfully; route selection alone is not proof that a model loaded.

## ModelPluginManager behavior

Replacing/removing a model retires the exact prior descriptor. If requests are active, the caller must explicitly pass \`confirmReplaceLoaded: true\` to approve registry replacement. This does not cancel or steal in-flight leases; it allows them to drain. New routes wait until the old generation is released. Replacement IDs must be unique, and concurrent asynchronous replacements cannot overwrite a newer registry descriptor.

## Limitations

- The router is in-memory accounting, not a runtime memory measurement or model-file hash verifier.
- The resource provider must supply trustworthy and current resource data.
- The router does not itself load/unload models; the native \`ModelPool\` is a separate primitive and is not yet wired to this TypeScript router.
- \`confirmLoaded\` records that the provider returned successfully; it is not runtime attestation, signed evidence, or authorization.
- Model output cannot authorize tools or approvals. APEX/Director and East/e3 boundaries remain unchanged.
