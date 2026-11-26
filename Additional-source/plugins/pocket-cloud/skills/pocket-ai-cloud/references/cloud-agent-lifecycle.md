# Pocket AI Lab cloud agent lifecycle

Assign one durable agent ID to one named cloud component. Keep its task context, decisions, release history, and operating runbook attached to that identity across restarts.

| Stage | Same agent's responsibility | Permission boundary |
| --- | --- | --- |
| Build | Prepare a feature branch, tests, and draft PR for its component | Repository access scoped to the component |
| Release | Provide the commit and test evidence for independent approval | CI deploys the approved artifact |
| Operate | Run the deployed component's approved jobs, report results, and diagnose failures | Runtime identity can reach only the component's services and data |
| Improve | Use operational findings to propose fixes through a new draft PR | Changes follow the same release path |

Give engineering, deployment, and runtime distinct credentials. APEX or the independently authorized release owner controls consequential operations. Keep runtime credentials free of repository write, deployment, and IAM privileges. Transfer operational findings through a task handoff.

Record the agent ID, component, allowed jobs, current release commit and artifact digest, runbook, and escalation owner. Attach the agent, release, and originating task IDs to each evidence record. Sync approved inputs, job status, and evidence. Keep private phone memory and model files local.

## First component

Start with approved document analysis. Have the agent propose and test the worker, then let that same agent run approved document jobs after the release is independently approved. Verify one live job and reconcile its returned evidence against the original Pocket AI Lab task.

This release retains the local [Vertex AI runner](setup.md) and adds [Cloudflare preparation](cloudflare.md) through the existing repository. The Cloudflare profile uses logical agent `pocket-cloud-analyst` and component `cloud-text-analysis`; existing Google identities and evidence are preserved. Hosted operation, scoped runtime credentials, deployment and native task integration remain pending.
