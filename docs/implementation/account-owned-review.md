# Recover a signed-in source review

The owner’s November 22 milestone calls for one in-app task that survives an interruption, produces one result, and lets the owner independently review the evidence. This implementation records a user-selected excerpt at its unique position in a supplied source. Its only execution effect is the committed review record. No model, paid provider, or external service is needed. [Owner’s milestone and six work chats](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/agent-coordination/coordination/POCKET_AI_LAB_COMPLETE_PRODUCT_HANDOFF_2026-11-17.md#kay-and-pocket-ai-lab-chat-cross-reference)

## Follow a task

1. Start the consumer app on the local host with Node 24 and `npm run start:web`. Open **Review tasks**. Create a local account or sign in to one created on this host.
2. Give the task a title, paste a passage, and enter an exact excerpt that appears once. Select **Start task**. This saves the pending task under the signed-in account.
3. Close the browser or stop and restart the app host. Reopen **Review tasks**, sign in to the same account, select the title and choose **Resume task**. A retry after a lost reply returns the original attempt and result.
4. Choose **Verify evidence** to check the signature, account, task identity, source, excerpt position and corrections. Add a correction and verify again. The original quotation stays in the signed record.
5. Save the public verification key separately from the receipt. For an offline check, supply a key obtained from the trusted host, the expected username and task UUID to the verifier. A successful check prints the attempt ID, committed execution count and correction count.

```bash
node tools/verify-review-task.mjs receipt.json pocket-review-public-key.json OWNER TASK-UUID
```

An older signed export can still pass its integrity check after the owner adds a correction. Reopen the task for the current revision. The verifier establishes the recorded excerpt and signature. Assessing whether the source itself is true remains a separate review.

## Where the data lives

The local server stores accounts, expiring sessions, tasks, corrections and its signing key in SQLite under `~/.pocket-ai-lab/review-accounts`. Set `POCKET_RECOVERY_DIR` to a dedicated absolute directory to choose another location. Existing directories on POSIX must be private to the host user. Keep the database outside the static web directory. The application stores task text and its signing key on disk under the host account’s filesystem protections. Anyone with control of that host account belongs inside the trust boundary.

Registration creates a real account on this app host. Salted password hashes and digests of session tokens are stored in the database. The browser uses an HTTP-only, same-site session cookie scoped to the review route. The local server checks the authenticated account on each task operation. Other app areas retain their existing identity and storage behavior. Native identity, shared sign-in between devices, encrypted backup and restoring a lost password require separate implementations.

## What the checks exercise

| Condition | Expected observation |
| --- | --- |
| Host stops before the SQLite transaction commits | The task remains pending. Retrying produces one committed execution. |
| Reply is lost after commit, then the host restarts | The same owner retrieves the identical signed result and attempt ID. Concurrent retries leave one execution row. |
| Another signed-in account knows the task UUID | Its task list is empty in the two-account fixture. Read, run and correction requests for the first owner’s task return 404. |
| Owner adds a correction and signs in again | The signed evidence contains the original excerpt, the correction and the original attempt ID. Retrying a correction with the same ID and note preserves one correction. |
| Displayed passage, signed fields, public key or expected identity changes | The independent verifier rejects the mismatch. Export in the app requires successful verification of the current selection. |

The store tests kill an actual process before and after commit and start competing processes on the same database. The browser tests drive the consumer app in phone-sized Chromium and WebKit, restart its server three times, discard a successful response and inspect the SQLite execution count separately. These tests exercise a deterministic local review. Model calls and external tools would need their own idempotency and recovery contracts. Physical iPhone, device-to-device transfer and production deployment remain separate release gates.

[Store tests](../../apps/web/test/recovery-store.test.mjs) · [Browser acceptance](../../tools/review-browser/account-recovery.mjs) · [Independent verifier](../../apps/web/recovery/verify.js)
