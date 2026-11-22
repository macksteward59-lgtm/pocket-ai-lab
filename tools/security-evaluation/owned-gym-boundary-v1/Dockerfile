# Compatibility PROBE only, not the real ExploitGym product or executor.
# CI pre-pulls the versioned runtime image, then builds with --network none.
FROM node:22.16.0-bookworm-slim
WORKDIR /work
COPY tools/security-evaluation/causal-counterfactual-v1/ /work/tools/security-evaluation/causal-counterfactual-v1/
COPY tools/security-evaluation/owned-gym-boundary-v1/run-owned.mjs /work/tools/security-evaluation/owned-gym-boundary-v1/run-owned.mjs
USER 65534:65534
CMD ["node", "/work/tools/security-evaluation/owned-gym-boundary-v1/run-owned.mjs"]
