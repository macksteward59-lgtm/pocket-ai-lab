# Conversational workspace requirements

**November 27, 2026 · Confirmed product direction; implementation and acceptance remain open**

## Confirmed experience

Pocket AI Lab presents one consistent conversational assistant that uses the existing harness, tools, models and specialist agents. Users can keep several separate conversations; one assistant identity does not mean one global transcript or one underlying physical model.

A sidebar separates projects from individual chats and provides access to tools, agents and teams. Both the user and the assistant can create tools, agents and teams. The main conversation carries requests, clarification, progress, results and corrections. The existing native-first, offline-first product direction remains in effect.

## Proposed navigation and creation behavior

| Area | Behavior to implement |
| --- | --- |
| Projects | Create, rename and select a project. Group its chats and expose its files, resources and context. Show the active project clearly. |
| Individual chats | Start and reopen conversations outside projects. Each conversation retains its own transcript, draft, model selection and task references. |
| Tools | Browse and create reusable operations with explicit inputs, outputs, implementation references and execution requirements. A functional tool needs a validated implementation, not only a name or prompt. |
| Agents | Browse and create specialist definitions with instructions, allowed tools, model preferences and memory scope. |
| Teams | Browse and create coordinated groups with member roles, assignments, completion rules and review responsibilities. |
| Main conversation | Keep one composer and assistant identity. Return delegated results to the originating conversation, including when the user navigates elsewhere while work runs. |
| Work details | Offer expandable tasks, evidence, artifacts and resource editors without requiring users to switch to a specialist chat to complete the task. |

On a phone, the sidebar may collapse into a drawer while retaining the same organization. Search and a visible New chat action are proposed conveniences.

Both a form and a conversational request should produce the same definition object and editor. Creating a resource, validating it, activating it and running it are distinct observable states. Routine actions already within the user's authority should proceed without redundant confirmation.

## Scope, persistence and lifecycle

Project conversations, standalone conversations and saved long-term memory are distinct records. Durable memory admission follows the existing review rule. Switching projects must not silently mix transcripts, sources, credentials or permissions. A workspace-wide definition can be reused while each execution remains restricted to its current project or standalone conversation.

Recommended definition fields are ID, kind, name, purpose, creator, owner, scope, version, state, configuration and requested capabilities. Tools additionally identify input/output schemas and their implementation and execution location. Agents identify instructions, pinned tool versions and model-selection rules. Teams identify pinned members, a coordinator and task/completion rules.

Editing an active definition creates a new draft version. Runs retain the versions with which they started. Archive a definition without erasing its historical evidence. New resources default to the current project when a project is active; otherwise use an explicitly displayed personal-workspace scope.

Execution records bind run ID, conversation ID, project/scope, pinned definitions, authorization, task/attempt/checkpoint identity, status and result/evidence references. The existing East lifecycle owns recovery; navigation or retry must not silently duplicate completed external actions.

## Existing harness contract

Director/APEX remains responsible for authority and scope. East/e3 remains responsible for task and attempt identity, checkpoints, cancellation and recovery. The eight permanent roles remain: Director, Reasoner, Researcher, Engineer, Security Analyst, Critic, Validator and Archivist. Custom agents and teams extend these capabilities.

Creation, activation, delegation and team membership do not create permissions. Model output is not an authorization receipt. The existing InferenceProvider abstraction and shared runtime remain the inference path. Honor manual model choice and identify unavailable choices; optional external execution uses the existing consent rules. The front assistant synthesizes specialist findings and preserves their evidence rather than treating consensus as proof.

## Implementation work packages

These packages are engineering proposals under the confirmed experience, not claims that the UI is already implemented.

| ID | Work package | Acceptance |
| --- | --- | --- |
| UX01 | Workspace records and sidebar navigation | Two projects, project chats and a standalone chat survive reload with stable IDs, distinct transcripts/drafts, selected model and active navigation. |
| UX02 | Conversation ownership of harness work | A team task launched in the main chat retains its origin while the user switches chats. Progress, failures and final synthesis return to that chat; cancellation/recovery retain existing task identity. |
| UX03 | Shared definition registry and editors | User forms and assistant requests create the same inspectable draft types for tools, agents and teams, with explicit creator, owner, scope and versions. Drafts are visibly distinguished from runnable resources. |
| UX04 | Validation, activation and governed execution | Validate dependencies, schemas and model compatibility; activate within actual authority. A created resource cannot broaden its own capabilities. A harmless working tool, custom agent and team can be invoked through the front assistant. |
| UX05 | Revision, reuse and recovery | Editing an active resource creates a new version; active runs keep their pinned version. Project isolation holds when a workspace definition is reused. Restart restores the same eligible work without duplicate effects. |
| UX06 | Integrated research journey and accessibility | In one chat, create a project, assemble a research team, create a citation-checking tool, review a supplied paper, correct the answer, restart and export evidence for independent verification. Verify keyboard/assistive navigation and mobile sidebar behavior on the applicable delivery surfaces. |

UX01 precedes durable conversation routing in UX02. UX03 can follow UX01 independently of runtime changes. UX04 depends on UX02/UX03 and the existing W04 authority/runtime work; UX05 completes lifecycle acceptance. UX06 combines these with W01/W02/W03/W09 research evidence. Source-card scores do not establish this user journey.

## Inspected implementation anchor and next slice

Read-only inspection of [apps/web/index.html](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/4d4baafeeaca5eaa409b2505c910dabcb5700a3e/apps/web/index.html) and [apps/web/app.js](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/4d4baafeeaca5eaa409b2505c910dabcb5700a3e/apps/web/app.js) found a sidebar and a chat composer, plus a separate team objective form. These inspected files do not expose project/conversation lists or tool/agent/team creation flows. The current new-conversation handler clears the displayed state; this is not evidence of a persistent multi-conversation workspace. The underlying harness may already contain reusable building blocks.

Start with UX01 and a thin shared creation-draft entry point in the existing web companion, after reconciling ownership of its shared files with the workshop lane. Extend the existing native workspace through its own verified integration path; a web prototype alone does not establish native or physical-device acceptance. No UX application code, browser acceptance or device result is asserted by this requirements record.
