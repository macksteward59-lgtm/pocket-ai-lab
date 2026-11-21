#!/usr/bin/env python3
"""Configure the isolated generated XCTest plan, or verify named fixture results."""
import collections
import glob
import os
from pathlib import Path
import plistlib
import re
import sys

EXPECTED = {
 'testProfileBoundsAndExactPromptConstruction',
 'testFinalParserRejectsReasoningRepairDuplicatesAndExtraContent',
 'testAllRequestsUseExistingRuntimeAndRetainCorrectnessSeparately',
 'testMalformedPartialAndFailedGenerationsRemainEvidenceWithoutRetries',
 'testBudgetRetainsEightRowsWithoutStartingRemainingRequests',
 'testCancellationPropagatesAndDoesNotScheduleAnotherRequest',
 'testModelIdentityChangesFailBeforeRequestsAndAfterCallback',
 'testForeignLeaseIsNotReportedAsAnOrdinaryGenerationFailure',
}
if len(sys.argv) == 3 and sys.argv[1] == 'verify-fixtures':
    text = Path(sys.argv[2]).read_text()
    outcomes = re.findall(r"Test Case '-\[(?:\w+\.)?DeepSeekQualificationContractTests (test\w+)\]' (passed|failed|skipped)",text)
    counts = collections.Counter(name for name,result in outcomes)
    if set(counts) != EXPECTED or any(n != 1 for n in counts.values()) or any(result!='passed' for name,result in outcomes):
        raise SystemExit('Required native fixture tests did not each pass exactly once: '+repr(outcomes))
    print('All eight native fixture tests executed and passed.')
elif len(sys.argv) == 4:
    derived,model,profile = sys.argv[1:]
    assert Path(model).is_absolute() and Path(profile).is_absolute()
    paths = glob.glob(str(Path(derived)/'Build/Products/*.xctestrun'))
    assert len(paths)==1, paths
    with open(paths[0],'rb') as f: plan=plistlib.load(f)
    if 'TestConfigurations' in plan:
        candidates=[(t,None) for c in plan['TestConfigurations'] for t in c.get('TestTargets',[])]
    else:
        candidates=[(v,k) for k,v in plan.items() if isinstance(v,dict) and 'TestBundlePath' in v]
    targets=[(t,k) for t,k in candidates if t.get('TestBundlePath','').endswith('/LlamaEngineTests.xctest')]
    assert len(targets)==1
    target,key=targets[0]
    identifier=target.get('BlueprintName') or key
    assert identifier and '/' not in identifier and '\n' not in identifier
    assert not target.get('OnlyTestIdentifiers') and not target.get('SkipTestIdentifiers')
    target.setdefault('EnvironmentVariables',{}).update({'POCKET_DEEPSEEK_QUALIFICATION':'1',
      'POCKET_DEEPSEEK_MODEL':model,'POCKET_DEEPSEEK_PROFILE':profile})
    with open(paths[0],'wb') as f: plistlib.dump(plan,f)
    with open(os.environ['GITHUB_OUTPUT'],'a') as f:f.write('xctestrun='+paths[0]+'\ntarget='+identifier+'\n')
else:
    raise SystemExit('usage: configure-test-plan.py DERIVED MODEL PROFILE | verify-fixtures LOG')
