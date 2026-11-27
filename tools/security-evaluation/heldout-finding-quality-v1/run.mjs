/** Scripted smoke baselines only — neither a model evaluation nor a pentest. */
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {evaluateFindingQuality} from './score.mjs';

export async function runSmoke() {
  const reference = JSON.parse(await readFile(new URL('./smoke-cases.json', import.meta.url), 'utf8'));
  // These are publicly seeded labels and simulated independent-review records.
  // An actual blind study must keep ground truth from the model/agent and obtain
  // independently verified host receipts after execution.
  const reviews = reference.cases.map(c => ({
    caseId: c.caseId,
    status: c.fixtureStatus === 'planned-synthetic-control' ? 'not-executed' : c.groundTruth === 'defect' ? 'reproduced' : 'rejected',
    evidenceId: c.fixtureStatus !== 'planned-synthetic-control' && c.groundTruth === 'defect' ? `fixture-${c.caseId}` : null,
  }));
  const controlled = reference.cases.map(c => ({
    caseId: c.caseId,
    decision: c.groundTruth === 'defect' ? 'finding' : 'no-finding',
    severity: c.groundTruth === 'defect' ? c.severity : null,
    evidenceId: c.groundTruth === 'defect' ? `fixture-${c.caseId}` : null,
  }));
  const naive = reference.cases.map(c => ({
    caseId: c.caseId,
    decision: 'finding', severity:'high', evidenceId:`fixture-${c.caseId}`,
  }));
  return {
    kind: 'scripted-public-smoke-only',
    controlled: evaluateFindingQuality({reference, submissions:controlled, reviews}),
    naive: evaluateFindingQuality({reference, submissions:naive, reviews}),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await runSmoke();
  console.log(JSON.stringify({kind:r.kind,
    controlled: {tp:r.controlled.truePositives,fp:r.controlled.falsePositives,adminFP:r.controlled.adminFalsePositives,recall:r.controlled.recall},
    naive: {tp:r.naive.truePositives,fp:r.naive.falsePositives,adminFP:r.naive.adminFalsePositives,precision:r.naive.precision},
    reproducedByModel: false, executedOwnedFixture: false, independentReviewExecuted: false},null,2));
}
