# OpenClaw development pilot

OpenClaw reads the saved CI evidence for Pocket AI Lab PR #245 and drafts a short review. ChatGPT checks the draft against the GitHub job before recording it in the shared handoff. This pilot runs once per invocation and exits. The project's iPhone runtime and Cloudflare notes service operate independently.

[Staged GitHub job](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44925093206/job/136909320451) · [Project handoff](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/agent-coordination/coordination/CLOUD_AGENT_HANDOFF.md)

## Run from an iPhone

Open the pilot pull request in Safari and select its **OpenClaw PR 245 review** check. Its run summary shows the draft, model and token usage. The workflow validates the setup pull request when it opens and when its branch is updated. A repository writer can rerun that job from Actions. After the workflow lands on the default branch, **Actions → OpenClaw PR 245 review → Run workflow** starts a new run. Changes to shared notes do not dispatch jobs.

The job requires this public repository and a standard Ubuntu GitHub runner. Model inference runs on the CPU of that runner. The job uses a read-only checkout and does not require Cloudflare or model-provider secrets.

## Run on Linux

On an x86-64 Linux machine with Python 3.11+, Node 24.22.3, npm, curl, tar and sha256sum, run this command from the repository root.

```bash
tools/openclaw-review/run-linux.sh > review.json
```

The script installs the locked OpenClaw package in a temporary directory, downloads the pinned llama.cpp CPU build and Qwen model, checks their SHA-256 digests, runs one review and removes the temporary installation. Allow several GB of free memory and disk space. The model download is approximately 1.12 GB. A host with those assets already installed can use `python3 tools/openclaw-review/review.py --help` to reuse them.

## Evidence and review

The sole input, [pr-245.txt](pr-245.txt), is the PR #245 evidence note (Cloudflare UUID `fbeaf347-16ee-5111-923f-e5812e8938c6`, revision 1), saved verbatim with a trailing newline. A fresh run uses an empty workspace, a loopback-only model server, tool denial and an empty list of model fallbacks. It prints a JSON receipt containing the evidence digest, model digest, provider, model, reported usage and draft text. The request disables tool calling at the model transport and constrains the draft to three labeled lines. The model writes the summaries and selects one of the limits identified in the fixed evidence. The runner compares the reported job ID and local test counts against the evidence. A mismatch marks the draft **Needs correction**. The summary displays the source job and local counts alongside the draft so a reviewer can see the discrepancy. Matched figures still require a human or ChatGPT source review before saving. A transport failure produces no report.

### Review the result in Pocket AI Lab

In the consumer app, open **Activity** to compare the bundled PR #245 model draft with the repository evidence and its source job. The app prepares a handoff summary directly from the recorded job, local counts and evidence limits, including when the model omits them. Use **Prepare a memory note** to edit your assessment and **Save memory** to keep it on the local server. It can then be reopened in **Memory** after a restart. Imported drafts remain unverified. The file picker reads the selected file on the device.

A new run can produce a compact file for that same view. The original full JSON output is also accepted. The compact export omits session IDs and internal provider metadata.

```bash
tools/openclaw-review/run-linux.sh --activity-record > review.json
```

### Native evaluation handoff

Activity also opens a single JSON attempt exported from the native self-evaluation history in PR #248. Select the file and paste the event SHA-256 copied separately from that history. The browser checks the original Swift payload bytes on the device before showing the reported model, status and output. **Prepare an evaluation note** copies the summary and event digest to the existing Memory editor. The owner decides what to save. The record stays unverified in Memory.

The cross-platform workflow builds the Swift exporter from the same checkout on macOS, reopens its fixture journal, checks the export with the independent Python reader, then supplies the same bytes and digest to the Chromium and WebKit tests. A separate CPU job runs the actual pinned model through OpenClaw and sends its fresh compact result to those same tests. Both browser runs check rejection of altered data and recover the saved notes after a server restart. The fixture has an explicitly unverified provider.


### Cloudflare handoff

The combined checkout includes the private note Worker under `workers/document-analysis/`. CI uses temporary credentials and a local Durable Object. It takes the actual notes recovered from both browsers, compares them, saves the agreed text over MCP, repeats the save with the original revision and reads it back after restarting the Worker. The connected Pocket AI Lab Handoff app can relay project decisions to the live preview separately. Saving notes is independent of model and build triggers.
