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

The sole input, [pr-245.txt](pr-245.txt), is the PR #245 evidence note (Cloudflare UUID `fbeaf347-16ee-5111-923f-e5812e8938c6`, revision 1), saved verbatim with a trailing newline. A fresh run uses an empty workspace, a loopback-only model server, tool denial and an empty list of model fallbacks. It prints a JSON receipt containing the evidence digest, model digest, provider, model, reported usage and draft text. Generation is variable. Compare the job ID, CI steps, local checks and limits against the source before relying on a draft.
