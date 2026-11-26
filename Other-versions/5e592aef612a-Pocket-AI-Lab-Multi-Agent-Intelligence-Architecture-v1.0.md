# Pocket AI Lab — Multi-Agent Intelligence Architecture v1.0

**Status:** Engineering Specification  
**Date:** 2026-11-02  
**Foundation:** Director/APEX + East/e3 + ExploitGym + Grok Workspace  

## 1. System Overview

Pocket AI Lab is a hybrid, offline-first multi-agent intelligence platform.  

**Core principle:** Agents collaborate to determine *what should happen*; the existing APEX/East authorization and evidence infrastructure determines *what is permitted to happen*.

| Design Dimension     | Decision                              |
|----------------------|---------------------------------------|
| Agent organization   | Hybrid: permanent core + dynamic specialists |
| Interaction          | Automatic collaboration               |
| Primary execution    | On-device                             |
| Network dependency   | Optional                              |
| Model architecture   | Model-independent                     |
| Governance           | Existing APEX/East controls preserved |
| Primary interface    | Native iOS Pocket AI Lab              |

## 2. Logical Structure

```
pocket-ai-lab/
├── apps/ios/                          # Native iOS application
├── packages/
│   ├── director/                      # Existing APEX governance
│   ├── exploitgym/                    # Existing cybersecurity workloads
│   ├── grok/                          # Existing workspace
│   ├── east/                          # Existing East/e3 durable execution
│   └── intelligence/                  # New multi-agent subsystem
│       ├── agents/
│       ├── orchestrator/
│       ├── model-registry/
│       ├── model-router/
│       ├── message-bus/
│       ├── deliberation/
│       ├── memory/
│       ├── knowledge/
│       ├── evaluation/
│       ├── policies/
│       └── telemetry/
├── runtime/
│   ├── ios/
│   │   ├── LlamaEngine.swift
│   │   ├── ModelPool.swift
│   │   └── InferenceScheduler.swift
│   └── adapters/
│       ├── llama-cpp/
│       └── cloud/
├── docs/
│   ├── architecture/
│   ├── agent-contracts/
│   └── implementation/
└── src/east/
    └── index.ts                       # East package entry
```

## 3. Existing Components (Preserved)

| Component                  | Role in New Architecture                  |
|----------------------------|-------------------------------------------|
| Director / APEX            | Central governance and orchestration      |
| East / e3                  | Durable workflow execution                |
| ExploitGym                 | Isolated cybersecurity evaluation         |
| Grok Workspace             | Project artifacts and context             |
| BridgeGate.swift           | Trusted-origin and message authorization  |
| RuntimeController.swift    | Model lifecycle and readiness             |
| LlamaEngine.swift          | Native inference abstraction              |
| Evidence.swift             | Signed generation evidence                |

**Known gaps (to be addressed):**
- iOS `LlamaEngine` defaults to unavailable implementation.
- East platform bridges require concrete implementation.

## 4. New Subsystem: Multi-Agent Intelligence Engine

### 4.1 Agent Manager
- Registers permanent agents.
- Creates and retires temporary specialists.
- Assigns capabilities, identities, and lifecycle state.
- Tracks availability and resource usage.

### 4.2 Model Registry
Models are independent of agents. An agent is a role + instruction set + state + permission profile.

### 4.3 Model Router
Routes based on: required capabilities, model availability, available memory, context window, latency, privacy, and current device load.

### 4.4 Message Bus
Structured, typed, immutable messages. Agents exchange task-specific messages with evidence references rather than full conversation histories.

### 4.5 Deliberation Engine
Bounded collaborative reasoning cycle (independent analysis → cross-review → challenge → revision → verification → synthesis). Default max two review rounds.

### 4.6 Memory Manager
Four layers: Working, Episodic, Semantic, Procedural. Provenance tracked on every stored conclusion.

### 4.7 Evaluation Engine
Tests whether work satisfies the original objective against evidence or executable tests.

## 5. Hybrid Agent Organization

### Permanent Core Agents

| Agent            | Primary Responsibility     |
|------------------|----------------------------|
| Director         | Delegation and synthesis   |
| Reasoner         | Logical decomposition      |
| Researcher       | Information gathering      |
| Engineer         | Software development       |
| Security Analyst | Security and risk          |
| Critic           | Challenge assumptions      |
| Validator        | Independent verification   |
| Archivist        | Knowledge and continuity   |

### Dynamic Specialists
Created on demand (e.g., Python debugger, Swift/iOS specialist, network security specialist). Results preserved as artifacts; active resources released on completion.

## 6. Trust Boundaries (Invariant)

**Untrusted intelligence layer:** LLM outputs, agent proposals, research findings, generated code, model tool requests.

**Controlled orchestration layer:** Agent identity, task permissions, capability checks, scope validation, resource limits.

**Independent authorization:** Existing APEX exact-scope approvals, execution contracts, audit records, signed evidence, independent repair authorization.

**Hard rules:**
1. A model cannot grant itself permission.
2. An agent cannot approve its own consequential action.
3. An agent conclusion is not an authorization receipt.
4. Agent-to-agent messages cannot bypass APEX.
5. Model replacement cannot silently change authorization policy.
6. Failed validation is never treated as successful execution.
7. Repair operations retain independent authorization.
8. Every consequential action has an attributable execution record.

## 7. Implementation Gates

| Gate | Name                     | Acceptance Criteria                                      |
|------|--------------------------|----------------------------------------------------------|
| 0    | Architecture audit       | Documented baseline, existing tests pass                 |
| 1    | Local inference          | Import, validate, load, generate, cancel, unload offline |
| 2    | Multi-model registry     | Switch models without changing orchestration code        |
| 3    | Agent orchestration      | Three agents complete shared task with attributable messages |
| 4    | Deliberation             | Agents identify and resolve deliberate disagreement      |
| 5    | Shared memory            | Retrieve relevant prior findings with provenance         |
| 6    | East/APEX integration    | Unauthorized actions denied; valid tasks auditable       |
| 7    | Full Pocket AI Lab       | Complete offline workflow with optional controlled network |

---

**Distinction to preserve:**  
Pocket AI Lab is the product.  
East is its durable execution foundation.  
APEX is its governance and trust layer.  
The multi-agent engine is its collaborative intelligence system.
