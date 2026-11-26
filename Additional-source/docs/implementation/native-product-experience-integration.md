# Native product experience integration

## Purpose

This change combines the previously separate native routed Agent Team, permanent-agent catalogue, specialist templates, and encrypted memory work into one native iOS application surface. It is an integration slice toward the complete Pocket AI Lab product, not a release declaration.

## Integrated native navigation

The app retains its existing Local AI, Workspace, and Runtime tabs and adds Memory. The Local AI tab retains model import/catalog selection, content-addressed model identity, one-resident-model ModelPool, chat, task history, self-evaluation, and runtime trust status.

## Agent Team

The Agent Team defaults to the eight canonical logical roles: Director, Reasoner, Researcher, Engineer, Security Analyst, Critic, Validator, and Archivist. The operator can remove or restore core roles and explicitly replace a selected role with a known specialist template. The first specialist set includes Swift/iOS, Python debugging, network security, database optimization, cryptography, performance, mathematics, and documentation.

The selected plan is validated by NativeAgentCatalog, bounded to eight unique known roles, then passed to NativeAgentCoordinator. The coordinator preflights every capability route before any model load or generation, runs roles sequentially, preserves untrusted prior proposals, and persists completed role messages before starting the next role. The one-resident-model policy remains in force; missing routes fail closed. A role is displayed in task history only after a real local model call has produced its output.

Capability labels are candidate-routing metadata only. They do not create tool permissions, quality ratings, runtime readiness, APEX approval, or evidence. Neither the catalogue nor the UI can authorize an action.

## Encrypted memory

The Memory tab is a user-controlled, device-local notebook. AES-256-GCM protects the vault; the random 256-bit key is held in Keychain with WhenUnlockedThisDeviceOnly accessibility. The encrypted file is stored in app-private Application Support with complete file protection. Create, edit, and delete are explicit user actions. Records include layer and descriptive provenance; new records are unverified and edits reset verification to false.

Chat and agent outputs are not automatically ingested, and memory is not automatically inserted into model context. No cloud sync, plaintext migration, or silent key replacement is provided. If the original Keychain key is missing, the existing vault fails closed rather than being overwritten.

## What remains outside this slice

- No physical iPhone Air install or runtime acceptance is claimed.
- No Automatic multi-model policy based on measured device performance, thermal state, or runtime attestation is claimed.
- No automatic memory retrieval, relevance ranking, cross-agent shared memory, or TypeScript/native memory synchronization is implemented.
- No East/e3 production scheduler, APEX authorization dispatch, or end-to-end consequential action execution is added by this change.
- ExploitGym remains a separate evaluation boundary; this UI does not execute arbitrary agent-generated workloads.
- Production release, signing, privacy review, telemetry, backup/recovery, upgrade, and rollback gates remain open.

## Required validation

Hosted CI must compile the native app for simulator and generic physical iOS, run app XCTest and package XCTest, and preserve existing runtime, routing, persistence, and governance suites. Hosted simulator results are CI evidence only. Physical acceptance must be recorded on the iPhone Air (256 GB), including actual installed iOS version, model import/hash verification, local generation, eight-role execution, specialist replacement, missing-route fail-closed behavior, cancellation, model unload/reload, memory CRUD, Keychain lock/unlock behavior, restart persistence, memory pressure, and thermal behavior.
