# PAL Authorization Surface Inventory POC v0.1

## Purpose
Add a bounded Python-AST inventory of Flask/FastAPI-style route declarations and locally visible authorization signals. It is a static research lead, not a vulnerability detector.

## Detected declarations
- Decorators named get/post/put/patch/delete/options/head, route, or api_route.
- Literal route paths and explicit methods where statically available.
- Local guard decorators with common authentication/authorization names.
- FastAPI-style Depends(...) and Security(...) parameter/default dependencies whose referenced name resembles a known guard.

## Output semantics
- local-guard-observed: a local decorator/dependency signal was found.
- no-local-guard-observed: no recognized local signal was found in this function.
- indeterminate: route path is dynamic or the inventory is partial.
- All routes remain informational. authorized=false and executes=false.

## Explicit limitations
This does not resolve router-level dependencies, inherited decorators, global middleware, reverse proxies, API gateways, external identity providers, policy engines, dynamic registration, aliases, or runtime configuration. A route without a locally recognized guard is not automatically vulnerable. It does not prove route reachability, user identity, ownership checks, tenant isolation, permission correctness, or exploitability. Findings require human review and independent verification.

## Safety
The parser uses Python ast.parse only. It does not import or execute source, contact targets, or authorize tests.
