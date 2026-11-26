#!/usr/bin/env python3
"""Preserve exact run/source/file identities, even when earlier steps failed."""
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys

root=Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
source=Path(__file__).resolve().parents[2]
for original,name in [(source/'scripts/model-qualification/deepseek-r1-distill-qwen-1.5b-v1.json','profile.json'),
                      (source/'runtime/ios/pin/llama-cpp.json','runtime-pin.json')]:
    data=original.read_bytes();destination=root/name
    if destination.exists() and destination.read_bytes()!=data:
        raise SystemExit('Refusing to overwrite divergent evidence '+name)
    destination.write_bytes(data)
def git(*args):return subprocess.check_output(['git',*args],text=True,cwd=source).strip()
clean = subprocess.run(['git','diff','--quiet','HEAD'],cwd=source).returncode == 0
files={str(p.relative_to(root)):{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
       for p in sorted(root.rglob('*')) if p.is_file() and p.name!='provenance.json'}
record={'schemaVersion':1,'kind':'deepseek-local-development-qualification',
        'githubRepository':os.environ.get('GITHUB_REPOSITORY'), 'githubRunId':os.environ.get('GITHUB_RUN_ID'),
        'githubRunAttempt':os.environ.get('GITHUB_RUN_ATTEMPT'),'githubSHA':os.environ.get('GITHUB_SHA'),
        'sourceHead':os.environ.get('SOURCE_HEAD'),'checkedOutSHA':git('rev-parse','HEAD'),
        'checkedOutTree':git('rev-parse','HEAD^{tree}'),'trackedSourceUnchanged':clean,'machine':platform.machine(),'platform':platform.platform(),
        'stepOutcomes':{name.lower():os.environ.get(name+'_OUTCOME') for name in
                        ['PREPARE','TOKENIZER','BUILD','FIXTURES','EXPERIMENT','INTEGRITY','QUALITY']},
        'files':files,'hardwareAcceptance':False,'modelPromotion':False,'authorized':False,'apexReceipt':False,
        'limits':'Hosted Intel macOS CPU; eight precommitted development cases, not held-out general quality, reference/native inference parity, ExploitGym, learned GIE or physical iPhone acceptance.'}
(root/'provenance.json').write_text(json.dumps(record,indent=2,sort_keys=True)+'\n')
if os.environ.get('GITHUB_STEP_SUMMARY'):
    with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as f:
        f.write('## DeepSeek local development qualification\n\n')
        audit_path=root/'audit.json'
        if audit_path.exists():
            audit=json.loads(audit_path.read_text())
            f.write('Measurement integrity: '+str(audit.get('integrityPass'))+'; separate quality gate: '+str(audit.get('qualityPass'))+'.\n\n')
            f.write('Correct complete final answers: '+str(audit.get('correctCount','unknown'))+'/8. All errors remain in the denominator.\n\n')
        f.write('Original SmolLM recipient/calibration results are unchanged. Hosted CPU results do not accept the model on a physical iPhone.\n')

if not clean:
    raise SystemExit('Tracked source changed after checkout; provenance is not accepted.')
