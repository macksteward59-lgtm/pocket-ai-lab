# Security Research Specialists v1.1

## 1. Overview
Adds six on-demand vulnerability-intelligence specialist templates under the
existing `security` core agent, plus the control path around them. Specialists
are task-scoped (`permanent: false`), carry only the `lab` (ExploitGym)
permission, and are released when the task ends. Nothing in this design
executes tools; it decides whether a tool request may proceed.

## 2. Specialist templates (`SECURITY_SPECIALIST_TEMPLATES`)
| Id | Focus |
|---|---|
| `microsoft-cloud` | Azure, ARM, Microsoft 365, Entra ID posture and configuration review |
| `identity-security` | OAuth2, SAML, OIDC, JWT architecture review |
| `windows-internals` | Windows process and token architecture research (read-only) |
| `reverse-engineering` | Static binary and assembly review inside ExploitGym |
| `ai-security` | Prompt-injection defense, RAG and Copilot-surface review |
| `network-protocols` | Protocol-conformance, TLS, Kerberos, SMB configuration review |

Templates define role, description, capabilities, and permissions only. They
carry no tool lists and no offensive logic. Tool adapters, if a deployer wires
any up, are outside this design and remain behind the delegation gate.

## 3. Control path
```
task text (untrusted)
   |
   v
routeSecurityTask  -- pure: scores specialists, flags operational intent
   |
   v
SecurityDivision.assemble
   |  operational intent? -> requires ApprovalVerifier to confirm a human approval (else refuse)
   |  creates non-permanent, lab-scoped specialists (team size capped)
   v
SecurityDivision.requestToolUse
   |  agent must be an active member of this task's team
   v
DelegationGate.authorize  -- fail closed; verifier injected; single-use vouchers; audit log
```

## 4. Trust invariants this design preserves
- A model cannot grant itself permission: routing output and task text can only
  add friction. Nothing in task text can lower an operational flag.
- An agent cannot approve its own consequential action: approval and voucher
  checks are injected by the host. This package does not supply them and does
  not read or replace the APEX trust placeholder.
- Requests are denied with no verifier configured. `allowed` on a gate decision
  is not the product `authorized` flag, which stays false.

## 5. Voucher rules enforced by the gate
A voucher is accepted only if the verifier accepts its signature **and** it
matches the request's agent, task, tool, and scope, is currently valid, has a
lifetime within the configured maximum (default 15 minutes), and has not been
used. A denied attempt does not consume the voucher. Concurrent use of one
voucher yields at most one allow.

## 6. Out of scope for v1.1
Selecting specialists inside `Orchestrator.executeTask` deliberation stages,
persistent or signed audit storage, and a concrete APEX verifier. See
`docs/implementation/security-specialists.md` for limitations.
