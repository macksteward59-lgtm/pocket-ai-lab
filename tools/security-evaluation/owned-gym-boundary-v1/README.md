# Owned-only worker isolation compatibility probe

**Status:** A small, executable **test harness**, not the original ExploitGym runtime and not a security certification. Main currently contains no `packages/exploitgym` source directory. We do not fabricate that missing implementation, replace its existing ZIP design, or infer a live integrated worker.

This new branch stacks on draft PR #282 (which already contains the source-pinned #281 synthetic causal counterfactuals). The parent synthetic source remains unchanged. The purpose is to test a concrete **host isolation envelope** before designing any authorized integration.

## Host controls declared and independently inspected by CI

- Docker container runtime, default seccomp profile retained, no privileged mode.
- `--network none` with only container loopback reachable by the owned HTTP fixture; no external security target and no host network/ports.
- Non-root uid/gid `65534:65534`; `--cap-drop ALL`; `--security-opt no-new-privileges`.
- `--read-only` root filesystem with only a 16 MiB temporary `/tmp`; no host mounts, Docker socket, credentials, or writable source tree.
- `--pids-limit 64`, `--memory 192m`, `--cpus 1`, and a 10-minute GitHub Actions job timeout.
- The worker asserts it has no outward-facing network interface, rootfs writes are denied, and the exact two source-level synthetic case variants each produce the expected host-only deterministic score. The script intentionally tries **no** external connection and runs **no** real model.
- CI inspects the actual created container configuration and checks worker output before considering the **compatibility smoke** passed.

## Reproduction and limitations

The path-scoped workflow `.github/workflows/owned-gym-boundary-ci.yml` is the reproducible, source-controlled configuration. It pre-pulls `node:22.16.0-bookworm-slim`, prints its resolved image ID, then builds without build-time network access. **The versioned image tag is not a digest pin**; exact supply-chain identity must be frozen and verified before a production claim. GitHub runner Docker controls are not proof against sandbox escape or a compromise of the host daemon.

The local script uses the existing `prepareCausalStudy`, `publicObservationBaseline`, and `scoreSubmission` public-template owned loopback code only. Its output is unsiged observational JSON; no Ed25519 evidence, trusted APEX approval, human validation, new vulnerability family, iPhone application, policy-domain authorization, real-target testing, arbitrary uploaded binary, private holdout, or ExploitGym product implementation is supplied. **All source and security-protection PRs stay draft.**

This test does not establish that an actual ExploitGym sandbox accepts an APEX-signed scope receipt. That requires verified source-recovery, a separately reviewed admission interface, and an owned workload integration test using the real runtime and preserved trust boundaries.
