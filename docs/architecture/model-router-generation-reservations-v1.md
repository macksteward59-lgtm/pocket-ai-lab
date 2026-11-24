# Model Router Generation Reservations v1

## Purpose

Prevent model replacement, removal, or failed inference from prematurely releasing memory reservations while concurrent agents still hold a route to the previous model generation.

## Reservation identity

- A route is tied to the exact ModelDescriptor object registered for that model generation.
- Concurrent routes using the same descriptor share one memory reservation and increment its reference count.
- Releasing one route decrements one reference; the memory reservation remains until the final route releases.
- A different descriptor reusing the same model ID is not treated as the same generation.

## Replacement and removal

1. ModelPluginManager captures the currently registered descriptor before resolving replacement input.
2. After asynchronous source resolution, it verifies that the registry still contains that exact descriptor. An overlapping replacement that lost the race is rejected.
3. It rechecks active route leases at commit time; an unconfirmed replacement is rejected if the model became active while preparation was in progress.
4. On confirmed replacement or removal, the old descriptor is retired. New routes cannot use it.
5. Existing old-generation leases remain accounted for until each caller releases the exact descriptor it received.
6. A new descriptor with the same ID is blocked while retired generations still have references.
7. After old leases drain, the new generation must pass a fresh memory admission check.

## Runtime-loaded model reconciliation

A provider's loaded-model ID can be stale after a model ID is replaced or removed. Retirement marks the ID as requiring a fresh load, so a stale resource-provider entry cannot bypass memory admission. The router clears that invalidation only after the inference provider successfully returns for the exact new descriptor through confirmLoaded().

All inference call sites release the selected descriptor in a finally block, including failure and cancellation paths.

## Boundaries and limitations

- The router manages estimates and leases; it does not load, unload, or attest models.
- Resource providers must report valid available memory and loaded model IDs.
- Memory estimates are caller/provider supplied hints, not measured resident memory.
- External runtime-owned models are not locally reserved; their memory must already be reflected in the resource provider's available-memory report.
- The current API uses descriptor identity plus reference counting. Each successful route caller must release exactly once; a future lease-token API would make duplicate-release detection stronger.
- This mechanism does not authorize model output, tools, device actions, target testing, or changes to APEX/Director/East trust.

## Validation

Tests cover shared route leases, memory remaining reserved until the final release, descriptor replacement, overlapping asynchronous replacements, external runtime-loaded IDs, stale-ID invalidation, removal, and inference-failure cleanup.
