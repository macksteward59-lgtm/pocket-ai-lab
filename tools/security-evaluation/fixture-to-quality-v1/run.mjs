/** An owned-loopback smoke bridge, NOT an agent security benchmark. */
import {fileURLToPath} from 'node:url';
import {runOwnedFixtureQualityStudy,scriptedClaims,scoreFixtureClaims} from './bridge.mjs';

export async function runScoredFixtureSmoke() {
  const packet=await runOwnedFixtureQualityStudy();
  const aware=scoreFixtureClaims(packet,scriptedClaims(packet,'known-oracle'));
  const naive=scoreFixtureClaims(packet,scriptedClaims(packet,'all-findings'));
  return Object.freeze({kind:packet.kind,referenceVisibility:packet.visibility,
    actualHttpRequests:packet.actualHttpRequests,externalTargets:packet.externalTargets,
    hostSelfConsistencyOnly:true,modelExecuted:false,independentReviewAttested:false,
    scenarioCount:packet.taskIds.length,caseCount:aware.caseCount,
    scriptedOracleAware:{truePositives:aware.truePositives,falsePositives:aware.falsePositives,
      adminFalsePositives:aware.adminFalsePositives},
    scriptedNaive:{truePositives:naive.truePositives,falsePositives:naive.falsePositives,
      adminFalsePositives:naive.adminFalsePositives},
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  try {console.log(JSON.stringify(await runScoredFixtureSmoke(),null,2));}
  catch(e){console.error(e);process.exitCode=1;}
}
