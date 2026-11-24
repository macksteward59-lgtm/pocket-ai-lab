# Local runtime prevention demo

Run from the repository root with Node.js 22.13 or later. The command uses only Node built-ins and writes the results into a new directory. Choose a fresh name for each run.

```sh
npm run demo:prevention -- prevention-evidence
node scripts/desktop/prevention-demo/verify.mjs prevention-evidence
```

The first command prints a SHA-256 digest. Keep it separately and supply it as the verifier’s optional second argument when checking a copied bundle. The verifier uses the checked-out fixture writer for the script identity and re-reads the saved files. The digest checks integrity against your saved copy. The bundle is unsigned.

| Stage | Observable result |
| --- | --- |
| Observe | The bundled writer modifies a real text file. Its write result, application and script identity, and the before/after content digests go into the execution report. |
| Detect | A different process with read-only access examines the file for a harmless marker. Matching run, path and exact bytes produce a rule scoped to a write on this one fixture file. |
| Enforce | A fresh instance of the same writer tries to replace the file with different bytes. Node denies the attempted write with `ERR_ACCESS_DENIED`. The same process writes successfully to the control file. |
| Review | The local test catalog records an unmatched observation for review. A synthetic maintainer alert goes to `developer-inbox.json`. The output directory also contains the catalog, both resulting files and `evidence.json`. |

This demo measures enforcement inside the supplied Node writer. Its application identity is assigned by the fixture harness. The detector recognizes a test marker, and the catalog contains test records. The experiment grants no Pocket approval and sends no external notification. Host-wide enforcement, arbitrary repository execution, malware detection and patch validation require separate evidence. Node documents the scope of its [permission model](https://nodejs.org/api/permissions.html).

Run the regression cases with `node --test scripts/desktop/prevention-demo/prevention.test.mjs`.
