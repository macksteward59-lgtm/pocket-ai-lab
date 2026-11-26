# Director task runtime composition

The bounded Director loop is composed at a host-owned composition root. The
intelligence package does not create network research, project inspection,
memory approval, device access, durable artifact storage, sandbox, or model
runtime adapters. The host constructs those dependencies and injects them.

## llama.cpp example

The following is the integration seam for a local llama.cpp server. Replace
the illustrative host adapters with implementations backed by the real
application services; do not use empty or permissive approval verifiers.

```ts
import { DirectorCapabilities } from "../../packages/intelligence/director/DirectorCapabilities";
import { createDirectorTaskRuntime } from "../../packages/intelligence/director/createDirectorTaskRuntime";
import { MemoryManager } from "../../packages/intelligence/memory/MemoryManager";
import { ToolDirector } from "../../packages/intelligence/tooling/ToolDirector";
import { ToolRegistry } from "../../packages/intelligence/security/tools";
import { LlamaCppDirectorCommandProvider } from "../../runtime/adapters/llama-cpp";

const capabilities = new DirectorCapabilities({
  memory: hostMemoryManager,
  research: hostResearchProvider,
  projectInspector: hostProjectInspector,
  memoryAdvisor: hostMemoryAdvisor,
  memoryApproval: hostMemoryApprovalVerifier,
  devicePermissionBroker: hostDevicePermissionBroker,
  deviceBridge: hostDeviceBridge
});

const toolDirector = new ToolDirector({
  registry: hostToolRegistry,
  builder: hostToolBuilder,
  sandbox: hostToolSandbox,
  artifactStore: hostArtifactStore,
  approvalVerifier: hostToolApprovalVerifier
});

const provider = new LlamaCppDirectorCommandProvider({
  api: "openai-chat",
  baseUrl: "http://127.0.0.1:8080",
  modelAlias: "model.gguf", // exact id from GET /v1/models
  timeoutMs: 120_000,
  maxTokens: 1024
});

const director = createDirectorTaskRuntime({
  capabilities,
  toolDirector,
  provider,
  maxSteps: 8
});

const result = await director.runTask({ taskId }, objective);
```

The host adapter variables above are intentionally not supplied by this
package. In particular, approval verifiers must validate fresh, narrowly
scoped approvals against the exact task and immutable action/artifact digest.
Do not treat a model-provided `approvalRef` as proof of approval.

## Trust and runtime boundaries

- Model function arguments are untrusted proposals.
- The task runner bounds dispatches and result history.
- The command router validates the command vocabulary again.
- `DirectorCapabilities` and `ToolDirector` enforce their own validation
  and approval requirements.
- A missing host capability fails closed; it is not replaced with a mock.
- This helper composes injected services; it does not provide production
  implementations, persistent task state, cancellation, parallel tool calls,
  a sandbox, or a durable artifact store.
- The llama.cpp provider requires the OpenAI-compatible chat API and a
  compatible `llama-server --jinja` model/template.

The composition helper is covered by a multi-step integration test and an
authorization-boundary test using host-injected test doubles.
