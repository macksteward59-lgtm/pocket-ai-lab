# DeepSeek local development qualification evidence

This directory retains complete development measurements for the additive local DeepSeek candidate. It does not replace the original SmolLM recipient/calibration records or promote a model.

| Run | Source | Measurement integrity | Frozen eight-case quality gate |
| --- | --- | --- | --- |
| [44870413700](44870413700/README.md) | PR #240, `e5cf16b9b3af96ab0fe4832105538abd5d22c551` | Passed; eight completed calls | **Failed; one valid and correct final answer out of eight** |

The run directory preserves original artifact bytes, full job logs, all raw outcomes, source identity, independent audit results and hashes. Code-fenced or otherwise malformed outputs remain failed under the frozen parser.

## Restoring the evidence

From a run directory, decode the original ZIP with Python:

```bash
python3 - <<'PY'
import base64
from pathlib import Path
data = base64.decodebytes(Path('artifact.zip.base64').read_bytes())
Path('artifact.zip').write_bytes(data)
PY
```

For any `.gz.base64` log, decode Base64 and decompress gzip:

```bash
python3 - <<'PY'
import base64, gzip
from pathlib import Path
source = Path('native-job.log.gz.base64')
Path('native-job.log').write_bytes(gzip.decompress(base64.decodebytes(source.read_bytes())))
PY
```

The run's `representation-index.json` supplies each original byte count and SHA-256, plus its restoration path. `artifact-members.json` supplies every ZIP member's size and SHA-256. The original ZIP is also bound to GitHub's artifact digest in captured run metadata.

The encoded files use 76-column Base64 with a final newline. Compressed logs use gzip level 9, mtime zero and an empty stored filename. JSON, JSONL, prompt files and small logs are direct byte-preserving copies. Extracted raw JSON records remove only their fixed marker prefix; the complete original log remains available.

`SHA256SUMS` in each run directory checks the published representations; decode them and compare the original-byte hashes when verifying restored files. The parent `SHA256SUMS` covers this index and all run files except itself. All failed cases remain evidence, with no format repair, alternate scoring or acceptance granted.
