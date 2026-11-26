# Three pinned vendor source modules — offline compatibility proof

This follows [draft #289](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/289)'s 87/87 success in joined host admission, owned causal evaluation, and East recovery **using vendor test doubles**. This next distinct test executes *real selected source modules* from the owner's three provided ZIP projects, without starting the full agent systems or any active offensive testing.

## Reusable source under test

| External project | Original pinned commit | Actual code executed |
| --- | --- | --- |
| [STRIDE-GPT](https://github.com/mrwadams/stride-gpt) | `5bc2c7b728e4c4d43da6defbf34c53a41d89b909` | `stride_gpt/core/drawio_parser.py`: parse owner-synthetic dataflow and trust boundary; reject XXE |
| [ARTEX](https://github.com/BaaRai/ARTEX) | `65045efae642159eeef3be5536c262f096f4c08d` | `db/coverage_ledger.go`: actual Go package `BuildCoverageLedger`, `CoverageCompletenessFor` via a small owned-input CLI |
| [ExploitGym](https://github.com/sunblaze-ucb/exploitgym) | `a8029e47135a29f1c1a6e79109bf86fba379b3f3` | `agent_scorer/validate_results.py`: actual quote validator on an owned synthetic source, with a separate stricter host confinement guard |

The GitHub Actions job checks out these exact public source commits instead of vendor-copying them into Pocket AI Lab. It uses the original ARTEX Go 1.26.10 module toolchain and version-pinned `defusedxml==0.7.1`. ARTEX's small Go adapter reads the reviewed STRIDE output via standard input; the actual Go coverage result is then read by ExploitGym's Python evidence checker. The ARTEX executable is run non-root in Docker using a digest-pinned base, `--network none`, read-only root, no capabilities, memory/CPU/PID limits, and no credentials or open ports. Dependencies may be fetched at *CI setup/build time*, but no target-facing requests are made by the fixture program.

## What the passing acceptance would establish

- Real STRIDE-GPT diagram source module extracts two synthetic system components, one trust boundary and one connection; rejects XML entity declarations.
- Actual ARTEX source recognizes `no_issue_found` **without evidence** as a coverage gap and a mandatory unexamined risk class as **not clean**. A paused run remains incomplete even if no finding is reported.
- Actual ExploitGym helper accepts a genuine source quotation and rejects a fabricated quotation. The independent host guard rejects parent-directory and symlink escapes **before** the upstream helper reads. The stock standalone helper accepts the synthetic parent reference; this is a *known integration-boundary concern*, not a newly exploited deployment.
- The three steps use one synthetic task ID and produce JSON observations with explicit `modelCalls:0`, `externalTargets:0`, `apexAuthorized:false`.

## Explicit limitations

This is real **component-source execution**, not full ARTEX's Go agent and offensive tools, STRIDE-GPT's LLM planner, or an ExploitGym Docker vulnerability/PoV benchmark. It is not a complete user-facing task, proven exploit, signed APEX scope approval, hosted PostgreSQL integration, cryptographically signed evidence, model-readiness proof, production deployment, physical iPhone run, or demonstration of increased research accuracy. The signed-input trust and untrusted-upload controls required for ARTEX and ExploitGym are separate from these source checks.

**License and integration:** no ARTEX AGPL code is copied into this repository. Source is checked out as an unmodified reference during CI. Respect ARTEX AGPL-3.0, STRIDE-GPT MIT, ExploitGym Apache-2.0 and the separate task-data licenses. The admitted full-engine sidecar direction remains draft #286; this test neither duplicates its admission contract nor changes existing APEX/East/ExploitGym/native implementations.

The original parent source branches and archived owner ZIPs are not modified. No model call, vendor agent launch, third-party target, key, deployment or merge is performed by this feature branch.
