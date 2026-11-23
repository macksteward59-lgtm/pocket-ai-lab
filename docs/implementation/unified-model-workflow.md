# From a model checkpoint to an answer in Pocket AI Lab

The owner wants the current model to stay selectable while another model works, teaches, or becomes the base of a new version. The intended destination is one offline-first native iPhone workspace with a shared conversation, inspectable results and optional compute on a trusted host. This guide tracks the model workflow against that product vision.

## Follow one task

1. Open **Chat → Choose model** or **Model workshop** in the consumer web app.
2. Choose where to train. **This browser** imports v1 document-reader JSON or starts with either of the two published readers. **Local training host** uses compatible language-model snapshots installed on an explicitly configured loopback host.
3. For distillation, choose the **Base model**, **Teacher model** and candidate name. The candidate starts from the base. The teacher supplies training signals on reviewed examples. Training writes a separate artifact. Compare the base, teacher and candidate on the same held-out questions.
4. In the browser lane, choose **Save candidate to my readers**. On the host, train all 24 steps at once or save a training draft after step 12. Reopen **Model workshop → Local training host**, select the draft by name, check its original parents and progress, and resume to step 24. Either saved candidate is eligible for another build. Saving a candidate does not assign it to agents or replace the configured chat provider.
5. Select the model under **Use a model** and choose **Use in Chat**. For a reader, the question and supplied passage travel with the selection. For a host language model, the submitted prompt goes to the selected local host. The reply identifies the model in the existing conversation. You can switch back to the configured chat model in the same transcript.
6. Choose **Review in Memory**, edit the proposed note and choose **Save memory**. Only this last action writes the note. The source field carries the model and passage or prompt digest. For a reader that selects a sentence, it also carries the sentence number. Candidate parent identities are included in the draft. Notes enter Memory as unverified.

### Edit one reader or combine two

In **Model workshop → This browser**, choose **Edit a copy of one reader** and select the base. Pick a named parameter, enter its new value and apply it to the copy. You can also edit the full JSON. Give the candidate a name. To combine two readers, choose **Combine two readers’ weights**, select both parents and enter the percentage the second parent contributes. With 35% from the second parent, each proposed parameter is 65% of the first value plus 35% of the second. You can edit the proposed blend before reviewing it.

Choose **Compare candidate** to see the parents’ and child’s scores on the same 16 held-out questions. The review reports how many of the 97 parameters you manually changed. **Save candidate to my readers** adds the child to the catalog. Selecting it in Chat or preparing a Memory note carries its actual creation method and parent identities. Exported JSON includes the final weights, parent hashes, blend percentage when applicable, and evaluation results. The original readers remain selectable.

This editor supports the versioned, 97-parameter document reader. Dense Llama checkpoints use the separate host training path below. Interpolation pairs corresponding hidden units, whose learned roles may differ. In the bundled example, combining 65% of the soft-label reader with 35% of the hard-label reader scored 15/16. The two parents scored 14/16 and 15/16. Those 16 questions are a fixed regression set.

### Compare the saved child and its parents on your own examples

In **Model workshop → This browser → Use a model**, select a saved child. Enter a question and a passage, one source sentence per line, and choose **Compare with parents**. Each row shows which sentence that reader selected or whether it found insufficient evidence. A typed question has no answer key. An edited child has one parent, and a trained or blended child has two. A starting reader can be evaluated on its own.

For scores, choose a local JSON question set. **Download example question set** provides the same 16 labeled questions used in the repository’s comparison on four additional documents. A set is an array of documents. Each document contains source sentences followed by question and answer pairs. Expected sentences are numbered from zero in the file. Use `-1` when the passage does not supply the answer.

```json
[
  {
    "sentences": ["The meeting starts at noon.", "It takes place in Room 4."],
    "questions": [
      ["Where is the meeting?", 1],
      ["Who is chairing the meeting?", -1]
    ]
  }
]
```

The results show how many questions each reader answered correctly against your labels. Select a question to inspect each answer, then choose **Use in Chat** on the reader you want. Chat opens with that reader, the question and its passage. You decide when to send. Comparisons run locally and the workshop keeps the question set in memory for the current review. Comparing a set leaves the models and their recorded training scores intact. [Download the example JSON](../../apps/web/model-workshop/comparison-example.json)

### Move a child and its parents to another browser

In **Model workshop → This browser**, select the child under **Use a model**, then choose **Export model family**. The file contains that reader and the parents and earlier generations it depends on. A common ancestor appears once. You can transfer the JSON file to another browser yourself.

Open the workshop in the destination browser while the app host is reachable so the browser can cache its offline files. Choose **Import model family**. Inspect the selected reader and the included models, then confirm the import. The app saves the family together. Existing local entries keep their names, a second import can reuse them, and both parents become available to start a new build. Use **Export weights** when you only need a single set of weights.

A family file carries model weights and recipe metadata. It excludes conversations, Memory entries, account data and CPU-host checkpoints. The receiving browser verifies the weight hashes, build IDs, linked parents and supported recipe metadata. It scores the supplied weights on the workshop’s held-out cases. Engines can round a prediction differently near its decision threshold. The preview shows any difference between the file’s counts and the local comparison. Newly added models use the local results. A matching saved entry retains its existing record. Newly imported builds record their ancestry as supplied by the file. The package carries no proof of who created the weights or ran the original training. The format supports up to 64 v1 document readers and 512 KiB per family file.

### Running the host path

Start the consumer app with the training environment’s `python3` on its PATH and `POCKET_TRAINING_DIR` set to an absolute host-owned directory. The supported files are a local `config.json`, `tokenizer.json` and unsharded `model.safetensors` for a compatible dense Llama model up to 160 million parameters. A configured host processes one workshop request at a time and uses a fixed synthetic document-verification recipe. The interface lets you select the models, run and compare them, and ask the candidate a question. Host imports are prepared on disk. Larger models, arbitrary training datasets and remote phone-to-host transport need separate support. [Host setup, format constraints and reproducible fixture](../../scripts/custom-gguf/workshop/README.md)

### What survives a restart

Saved reader weights, their local training record and both parent identities persist in the browser’s IndexedDB at the same origin. The browser can reopen the cached app and train another reader offline. Exported JSON includes portable weights and a declared training record. When a reader is reimported, the workshop checks its weights against the local catalog. A known local build can reopen with its recorded parents. Two builds may have identical weights and different parents. Unrecognized single-reader imports become plain weights. Use the family file when the destination also needs the linked parent models. Clearing site data removes the browser catalog. Host checkpoints live on the configured host. The web Memory store requires the local server and uses its existing storage and access controls. Chat turns and unsaved drafts are session state. A host training draft preserves the LoRA weights, AdamW state and position in the workshop’s fixed training examples. You can resume it after closing the app or restarting the local host. An imported model supplies starting weights for a new run. Resuming another trainer’s optimizer format remains an open requirement.

## Conversation-to-release trace

The **owner direction** rows summarize the available project conversations. **Engineering choice** and **research proposal** identify decisions about implementation or experiments. The PR links identify the relevant code or evidence. The acceptance column names the additional observation required before a broader release claim.

| Requirement and origin | Evidence or implementation | Broader release acceptance |
| --- | --- | --- |
| Owner direction, Nov 1 and Nov 22. One in-app conversation, switchable models, existing checkpoints preserved. | This candidate connects Workshop, Chat and Memory. The registry can register or replace descriptors. The shipping target's native catalog and role routing have separate drafts. [Registry](model-plugins.md) · [Native catalog](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/115) · [Role routing](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/147) | Reopen a signed native conversation, switch the actual providers, and retain the thread, model attribution and independently checked device evidence. A visible web transcript does not establish cross-provider context replay. |
| Owner direction, Nov 22. Import a partially developed model, continue from it and derive new models from two working models. | This workshop selects both parents, trains a separate candidate, scores it and allows reuse. A saved host draft can continue its optimizer from a committed step. The local language-model path builds on the earlier LoRA experiment. [First LoRA export](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/17) · [Document teacher](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/287) · [Earlier browser workshop](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/295) | Demonstrate a useful improvement on fresh independent documents with the intended real imported models. Qualify each added architecture and artifact format. General architecture editing, language-model weight merging and importing foreign optimizer formats remain open. |
| Engineering choice. Begin with teacher-guided builds, measured failure cases and explicit candidate selection. | The fixed reader comparison uses 16 questions. The full-paper experiment illustrates a different task where the first approach struggled. Governed learning has a separate integration draft. [Full-paper experiment](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/290) · [Learning workflow](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/217) | Record frozen training/evaluation splits, evaluate both parents and the child, compare on new material, and independently review promotion and rollback. A repeat of the fixed comparison measures regression. |
| Owner direction, Nov 16–22. Operate offline first, use larger models on demand and make the actual execution location visible. | The reader runs in the browser. The optional CPU trainer runs on the loopback host. Earlier native work covers availability, load, cancel and device evidence. The cloud draft requests consent for the selected outbound text. [Device kit](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/269) · [Cloud consent](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/236) | On the physical iPhone Air, run offline, cancel, restart and verify a signed export. For remote compute, separately demonstrate authenticated consent, data minimization, budget, cancellation, genuine provider attribution and recovery on one task. |
| Owner direction. The companion accepts an objective, keeps project context, offers research or a provisional answer, and lets the owner decide what enters memory. The personal task list and the AI's work queue are separate. | This path moves a selected answer and its source into a user-editable draft. The existing Memory API owns the save. Project handoff covers working, episodic, semantic and procedural memory, source retrieval, teaching and temporal reasoning. [Complete handoff](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/agent-coordination/coordination/POCKET_AI_LAB_COMPLETE_PRODUCT_HANDOFF_2026-11-17.md) | Restore the native objective, task ID, sources and revisions after interruption. Verify permission to sync, personal-queue visibility, encrypted persistence and conflict handling on the same build. |
| Owner direction. Core agents and specialists use appropriate models. Director/APEX governs consequential work. East/e3 preserves task state. | The repository has separate agent, routing, authorization and lifecycle implementations. This workshop records training and inference provenance. Its output has no authority to grant permissions. [Provider-backed deliberation](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/227) · [Lifecycle integration snapshot](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/273) | Run one named task through the intended roles, preserve genuine disagreement and independent review, enforce the actual authorization boundary, then restore the same task after a restart. |
| Owner direction. Keep the six-layer/M01–M42 capability inventory, evaluation, threat modeling and human-reviewed reporting in the product plan. | The master checklist records recovered module identities and gaps in the original mapping. Existing evaluation work covers evidence comparison and research fixtures. [Master checklist](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/agent-coordination/docs/requirements/POCKET_AI_LAB_MASTER_REQUIREMENTS_CHECKLIST.md) | Trace authorized defensive evaluation to its scope, rubric, evidence and reviewer. Workshop model choice alone grants no tool access. |
| Research proposals. G.I.R.L., geometric representations, compact agent communication and multi-perspective reasoning require separate qualification. | Representation contracts and same-model constraints are documented independently of the training UI. [G.I.R.L. integration record](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/agent-coordination/coordination/GIRL_GEOMETRIC_LATENT_INTEGRATION_2026-11-19.md) · [Compatibility draft](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/235) | Show a recipient using a representation successfully against blinded controls on a compatible model/runtime. Keep unsuccessful experiments in the record. |

### Sources behind the trace

These are dated summaries of accessible messages, retained without private conversation links. The coordination handoff carries the longer recovered history.

| Owner message (UTC) | Decision carried forward |
| --- | --- |
| Nov 1, 15:48 | One app with a shared thread and selectable Pocket or Grok models. A proposed readiness contract later distinguished a registered model from successful generation. |
| Nov 16, 22:06 | One mobile-first platform for local, private and authorized external models, persistent memory, governed work and evidence. |
| Nov 20, 01:16 and 19:49 | Integrate the components as one project. Use larger cloud models per task while preserving local work. |
| Nov 21, 18:53 | Continue toward a working ecosystem that takes one objective through to a result. |
| Nov 23, 01:48 | Keep existing models as options, build on partial checkpoints, and create a new model using two imports. The base/teacher arrangement was the subsequent engineering proposal. |

The plug-and-play discussion also covered using completed PentestGPT session events as evidence. That importer was proposed in chat. It has no implemented entry in this workshop. The model selector chooses inference or training artifacts. Tool registration, permissions and execution have separate contracts. [Director Tool Workshop](director-tool-workshop.md)

## Evidence for the main-targeted candidate

The earlier workshop was stacked on the document-research branch. [PR #296](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/296) brings its runtime files, pinned datasets, model artifacts and regression tests together with the Chat, Memory and local-host paths in a review targeting `main`. The [browser and CPU acceptance run](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45100540298) exercised both model types in Chromium and WebKit. The browser reader went from 14/16 to 15/16 in the selected parent order. On the tiny causal-model fixture, base, teacher and child scored 2/4, 4/4 and 2/4. Changed weights, real generation and reusable lineage were observed. A predictive gain on the language-model task remains unproven.

The integration branch and its base each produced the same 21 TypeScript diagnostics in the existing autonomy tests, including missing East lifecycle modules. The repository-wide build and consumer checks must pass on the release commit before it is called integrated. The owner’s physical phone, larger third-party checkpoints and any paid or hosted provider were outside these checks.

## Releasing the integrated version

Use the repository-wide matrix for individual requirements, including the areas outside the model workflow. Relevant rows include PAL-00-001 through PAL-00-010 for the unified product, PAL-06-013 through PAL-06-023 for routing and model lifecycle, PAL-07-013 for physical-device acceptance, PAL-09-006/012/013 for memory and training, and PAL-25 for the definition of done. The source inventory covers the available conversations and handoffs. Missing original descriptions, private-chat gaps and research proposals must retain their existing status. [Requirement traceability](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/agent-coordination/docs/requirements/POCKET_AI_LAB_REQUIREMENTS_TRACEABILITY.md) · [Current coordination](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/agent-coordination/coordination/CLOUD_AGENT_HANDOFF.md)

For a release, record the final integrated commit, branch or tag, entry point, actual model and provider, execution location, test run and remaining exceptions. Repeat the workshop’s mobile browser and host tests on that commit. Run the signed native and consented cloud scenarios separately where the release promises those features. Record review, merge and deployment independently. The public Cloudflare website and private handoff service are separate deliverables. [Website draft](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/294)
