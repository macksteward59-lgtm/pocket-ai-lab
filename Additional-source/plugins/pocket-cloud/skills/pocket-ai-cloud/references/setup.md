# Pocket AI Lab Google Cloud setup

This release is a private plugin with a local Codex runner. It offers a manual handoff into Pocket AI Lab. Native iOS, APEX receipt verification, East workflow execution, and automatic synchronization are not wired into this release.

## Configure the runner

Use Python 3 and the Google Cloud CLI on the machine running Codex. Use a Google Cloud project with billing and Vertex AI enabled. The calling identity needs permission to invoke the chosen Vertex AI model. Configure Google Application Default Credentials locally with `gcloud auth application-default login`. For an authorized service environment use a workload identity. Keep tokens and credential files outside the plugin, task context, and repository.

Export `POCKET_VERTEX_PROJECT`, `POCKET_VERTEX_LOCATION`, and `POCKET_VERTEX_MODEL` to select a project ID, explicit regional location, and model ID available in that location. The runner does not change these values or use a global fallback.

## Preview and submit

Pass a JSON object with exactly `task_id`, `purpose`, and `selected_text`. Supported purposes are `documentation`, `test-summary`, and `design-review`. The task ID remains local. The preview shows the complete request body and destination with a digest. The digest binds the preview to the body, destination, and task. It is a change detector, not an APEX receipt or proof of authorization.

From this skill directory, run `python3 scripts/offload.py preview < request.json`. After approval of the displayed request, run `python3 scripts/offload.py submit --approved-digest DIGEST < request.json` with the same input and configuration. The script makes one request per invocation. If a call times out or its outcome is unclear, Google may already have processed it. Inspect the outcome before considering another submission.

A successful response carries the original local task ID, provider, requested model, digest, optional provider response ID and usage, and reply text. Copy that record to the existing task's evidence through its local owner. The plugin does not save transcripts, change task state, execute model instructions, or provision Google Cloud resources.

[Google Cloud authentication](https://docs.cloud.google.com/docs/authentication/application-default-credentials)  
[Vertex AI regional endpoints](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations)
