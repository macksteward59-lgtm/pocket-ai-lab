# Local Director approval registry

LocalApprovalRegistry is a process-local adapter implementing the three existing approval ports:

- DevicePermissionBroker for exact device permissions, resource IDs, task IDs, and action digests. Resource-scoped permissions (`apps.open`, `files.read`, `files.write`, `files.delete`) require a resource ID; broad inventory permissions (`apps.list`, `storage.inspect`) reject one.
- MemoryChangeApproval for exact proposal IDs, change indexes, task IDs, and change digests.
- ToolApprovalVerifier for activate/retire operations bound to tool ID, version, task ID, and artifact digest.

## Security behavior

- grant(scope) creates a cryptographically random, opaque, one-time reference. The registry stores only its SHA-256 hash.
- A grant expires after 60 seconds by default (configurable from 1 second to 5 minutes).
- A successful verification consumes the grant. A scope mismatch does not consume it.
- Expired grants are pruned; pending grants are bounded (256 by default).
- References can be revoked before use.
- Grants are held only in process memory and disappear on restart. This is intentional; no approval survives a server restart.
- The verifier does not display an approval prompt and does not authenticate a human by itself.

## Trust boundary

Only call grant() after a trusted host UI has authenticated the user and the user has explicitly approved the exact action details. Do not expose grant() as a Director tool, public API, unauthenticated endpoint, or general-purpose RPC. The model must never mint or choose its own approval reference.

This adapter is a reusable security primitive, not a complete approval UI or production device integration. The local web runtime does not wire it into DirectorCapabilities or ToolDirector until an authenticated approval surface exists. Missing verifiers therefore continue to fail closed.

## Host composition example

Use one registry instance for the relevant ports so each grant is checked by the same in-process authority:

```ts
const approvals = new LocalApprovalRegistry();

const capabilities = new DirectorCapabilities({
  memory,
  memoryApproval: approvals,
  devicePermissionBroker: approvals,
  deviceBridge: hostDeviceBridge
});

const toolDirector = new ToolDirector({
  registry,
  approvalVerifier: approvals
});

// Only after the trusted UI has shown and the user has approved this exact action:
const approvalRef = approvals.grant({
  kind: "device-action",
  taskId,
  permission: "files.read",
  resourceId: fileId,
  actionDigest
});
```

A future UI must calculate the action digest from the same canonical action snapshot the host will execute, show the user the target and consequences, and issue a grant only after explicit confirmation. A production host also needs authenticated UI/session protection, a concrete OS-sandboxed device bridge, and an audit trail that never records the bearer approval reference.


## Durable tool artifact history

`FileToolArtifactStore` implements the workshop's `ToolArtifactStore` port for a private local application-data directory:

- Stores each tool version as JSON under a validated kebab-case tool ID and numeric version.
- Uses owner-only directory/file modes where supported, temporary files plus atomic rename, and file/directory synchronization.
- Rejects symlinked tool directories, unsafe IDs, corrupt records, mismatched record identities, and records larger than 2 MB.
- Returns detached copies and preserves version history while allowing lifecycle status updates to replace the same version record.
- Never imports or executes generated source.

Example:

```ts
const artifacts = new FileToolArtifactStore(appPrivateDataDirectory);
const toolDirector = new ToolDirector({
  registry,
  builder,
  sandbox,
  store: artifacts,
  approvalVerifier: approvals
});
```

The adapter is intentionally not wired into the web runtime yet: the runtime still lacks a real isolated sandbox, builder, and authenticated human approval surface. This is a single-process local store, not a multi-host database, and it does not encrypt source at rest. Use an OS-protected/encrypted app-data volume for sensitive artifacts.
