# Dependency review and GitHub tooling candidates

## XBOW Engineering · November 24, 2026

| Repository | Decision for Pocket AI Lab |
| --- | --- |
| [Trivy issue reporter](https://github.com/xbow-engineering/xbow-trivy-report-issue-action/tree/f1b7d27baa91506ba15a4a2e8d8b6e2eb0bb5678) | Use the idea of formatting a saved report locally. Pocket implements an independent parser and preserves the source and fix for every finding. |
| [Shuru](https://github.com/xbow-engineering/shuru/tree/f21559ddbe85cc9e891897591cbc316cea92a922) | Candidate for a later disposable-host comparison. Its documented targets are Apple Silicon macOS and experimental ARM64 Linux/KVM. A host result would need separate physical iPhone evidence. |
| [Validation benchmarks](https://github.com/xbow-engineering/validation-benchmarks/blob/a16cb1ba0701b20d63913846536fc7b0672082af/README.md) | Historical reference. XBOW reports saturation on these 104 cases. Keep independent, held-out cases for model comparisons. |
| [mitmproxy](https://github.com/xbow-engineering/mitmproxy/tree/74ac9d8b43d48ab39446d2f7759a379324999228) | Consider synthetic response playback for optional-cloud failure tests. |
| [dockerode](https://github.com/xbow-engineering/dockerode/tree/1e96a98f54356013d8dcf101c89edaef13a3f341) | Defer until a host-side test requires a Docker client. |
| [docker-modem](https://github.com/xbow-engineering/docker-modem/tree/bfa274c601d50d755fdb84f10c8680a6590024d8) | Lower-level Docker transport. No separate dependency identified for this importer. |

Four offline checks of XBOW's pinned formatter covered grouping, suppression by existing title, two lockfiles and empty input. For the same package and version in two lockfiles with different fixes, the generated Markdown kept both advisory IDs but displayed only the first target and fix. Pocket's [local import](../implementation/governance-as-review.md#review-a-saved-trivy-dependency-report) keeps each pairing and leaves publication to the owner.

## Chris Gavin · November 24, 2026

Screened 113 public repository names returned by GitHub, including forks. The following are design references. None is required by the import path.

| Reference | Relevant behavior and fit |
| --- | --- |
| [gh-dispatch](https://github.com/chrisgavin/gh-dispatch/blob/09d45b970693ea0e23fdcf6becc50ecc67a05805/internal/dispatcher/dispatcher.go) | Requests the run ID and URL when dispatching a workflow and rejects a missing ID. This would tie a future owner-approved acceptance run to its receipt. A dispatch alone supplies no passing result. |
| [paginated-go-gh](https://github.com/chrisgavin/paginated-go-gh/blob/65e6bc902938f2d812b92d5797ca1adbef4b6473/pkg/paginated/rest.go) | Follows the next-page link for JSON reads. Use multi-page fixtures when checking completeness of repository inventories and evidence collectors. |
| [create-or-update-issue-action](https://github.com/chrisgavin/create-or-update-issue-action/blob/2f369cf2802b7d643e5cb5aa0c779028778e9e97/src/index.ts) | Paginates issues and matches by exact title. A title may cover several lockfiles. Pocket keeps target, advisory and fix together and produces a review draft locally. |
| [gh-deflake](https://github.com/chrisgavin/gh-deflake/blob/dfa637573b5ca1123d3c3dc3ddf73732ab36d8f0/README.md) | Reruns failed CI checks. Keep first-attempt failures and any retries individually attributable in acceptance evidence. |
