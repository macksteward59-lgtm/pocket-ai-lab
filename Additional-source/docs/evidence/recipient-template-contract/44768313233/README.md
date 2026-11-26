# Exact pinned GGUF template metadata — run 44768313233

The metadata-only [workflow 44768313233](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44768313233), attempt 1, **passed** all 20 fixture tests, exact pinned-file download verification, extraction and artifact upload. It performed no template rendering, tokenization, model inference or recipient scoring.

General [Pocket AI Lab CI run 44768245546](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44768245546) also passed on the same source. `workflow-checkpoint.json` records both terminal results verified during evidence publication. These two successes do not replace the inherited frozen-recipient failures.

## Source and artifact

- Draft [PR #233](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/233), source `be72e9f6873b8890a2ccd5c8d78709e073109868`.
- Checked-out merge: `2b4fa78a666d6e3c226483380f4c2b6c1efccfd3`.
- Identical source and checkout tree: `3464c517402ac5e4e6e8bb64dfbedb48d884b307`.
- Job: `136398845400`.
- Artifact: `14645708185`, `recipient-template-contract-44768313233-1`.
- ZIP: 3,177 bytes; SHA-256 `540b5cdbd303147cd701defea5dd48ba8b63811df3076ea799ad5b75c2a1011a`.

The hosted probe hashed all 105,454,432 bytes of the existing pinned GGUF and matched SHA-256 `2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d` before parsing the retained metadata prefix. The local evidence audit verified the ZIP and all members, source-tree identity, original pin bytes, provenance digests, exact template bytes and special-token string hashes. It did not download and rehash another local copy of the model.

## Observed declarations

`chat-template.txt` contains the exact **368 UTF-8 bytes**, without an added newline or other normalization. Its SHA-256 is `872be49dbb638044ad01b60388f48d469ff2980e5f0dccdc22ec907db54d0788`. The original `metadata.json` also carries those bytes as text and Base64.

The template declares role/content framing using `<|im_start|>` and `<|im_end|>`, supplies a default SmolLM system message if the first message is not a system message, and optionally appends an assistant-generation prefix. This is a description of the extracted data, not execution of the template.

| Metadata declaration | Observed value |
| --- | --- |
| Tokenizer model / pretokenizer | `gpt2` / `smollm` |
| Vocabulary count | 49,152 |
| Add BOS / add space prefix | `false` / `false` |
| BOS token | ID 1, `<|im_start|>` |
| EOS and padding token | ID 2, `<|im_end|>` |
| Unknown token | ID 0, `<|endoftext|>` |
| Add EOS / clean spaces / remove extra whitespace | Absent; remain unknown in this metadata report |

The file declares little-endian GGUF 3, 37 metadata keys and 272 tensors. Header plus metadata occupies 1,769,787 bytes. Tensor directories and tensor payloads were not validated by this restricted reader.

## Evidence files and limits

The original artifact JSON files (`metadata.json`, `model-pin.json`, `llama-cpp-pin.json`, `provenance.json`) are preserved byte for byte. `artifact.zip.base64` preserves the original ZIP bytes. Additional capture provenance, compact outcome, exact template bytes, complete job log, source-review note and this README describe the audit. `SHA256SUMS` binds all files.

The complete job log is 21,697 bytes, SHA-256 `03073bc1941c52d25d8d7d59e41b3d7d829121ef798e2ccbc2012b0f15492ce8`. `tokenization-contract.md` records independent read-only inspection of the exact Pocket bridge and pinned llama.cpp source. The bridge passes the supplied string directly to tokenization and does not apply a chat template. Recognition of a declared marker still depends on the loaded vocabulary attributes and effective flags; a template alone is not an observed tokenization result.

The next input-contract check needs exact rendered prompt bytes, relevant effective vocabulary attributes/flags, and an observed native token sequence. A later response-format pilot needs a separately frozen manifest before any new generation output is observed. Neither this successful metadata probe nor the source review identifies the cause of v1's failures or establishes improved answers. Both preserved v1 runs remain negative with their original failed gates. No production recipient route or learned GIE mapping is established.
