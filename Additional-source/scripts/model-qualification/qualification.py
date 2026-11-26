#!/usr/bin/env python3
"""Independent preparation/audit of a bounded DeepSeek development experiment.

Reuses the existing hash-verified GGUF metadata reader; never executes a model
chat template, calls a provider, or changes the frozen recipient experiments.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'runtime/ios/scripts'))
from recipient_gguf_template import inspect_model

PROFILE = Path(__file__).with_name('deepseek-r1-distill-qwen-1.5b-v1.json')
MODEL_ID = 'deepseek-r1-distill-qwen-1.5b-q4_k_m'
DIGEST = '1741e5b2d062b07acf048bf0d2c514dadf2a48f94e2b4aa0cfe069af3838ee2f'
MODEL_BYTES = 1117320800
PIN_COMMIT = '5f490d7bfe78844e6390c869454c149fd7e003a8'
BOS = '<｜begin▁of▁sentence｜>'
METHOD = 'getrusage-RUSAGE_SELF-ru_maxrss-bytes'
SCOPE = 'whole-inference-process-high-water'

class QualificationError(ValueError):
    pass

def require(ok, message):
    if not ok:
        raise QualificationError(message)

def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON key: ' + key)
        result[key] = value
    return result

def invalid_constant(value):
    raise QualificationError('non-finite JSON number')

def decode(raw):
    return json.loads(raw, object_pairs_hook=unique, parse_constant=invalid_constant)

def read_json(path, cap=2_000_000):
    with Path(path).open('rb') as f:
        raw = f.read(cap + 1)
    require(len(raw) <= cap, 'JSON input exceeds bound')
    return decode(raw), raw

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def store(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + '\n')

def profile_at(path=PROFILE):
    p, raw = read_json(path, 131072)
    require(p['schemaVersion'] == 1 and p['model']['id'] == MODEL_ID, 'wrong candidate profile')
    require(p['model']['sha256'] == DIGEST and p['model']['bytes'] == MODEL_BYTES, 'wrong model pin')
    require(p['runtime'] == {'tag':'b12233', 'commit':PIN_COMMIT}, 'wrong native runtime pin')
    require(p['settings'] == {'contextLength':2048, 'maxTokens':512, 'temperature':0,
            'maxOutputBytes':16384, 'maximumDurationSeconds':900}, 'changed v1 generation settings')
    require(p['chat'] == {'prefix':'<｜User｜>', 'suffix':'<｜Assistant｜><think>\n'}, 'changed candidate framing')
    require(len(p['cases']) == 8 and len({x['id'] for x in p['cases']}) == 8, 'expected eight unique cases')
    require(p['evaluation']['requiredCorrect'] == 8 and p['evaluation']['requiredValidFinal'] == 8,
            'v1 gate must require all eight cases')
    for field in ('modelPromotion','hardwareAcceptance','authorized','apexReceipt'):
        require(p['evaluation'][field] is False, 'qualification cannot grant ' + field)
    for c in p['cases']:
        require(isinstance(c['id'], str) and re.fullmatch(r'[a-z0-9-]{1,80}', c['id']), 'invalid case ID')
        require(isinstance(c['prompt'], str) and 1 <= len(c['prompt'].encode()) <= 2048 and '\0' not in c['prompt'], 'invalid case prompt')
        require(isinstance(c['expectedAnswer'], str) and 1 <= len(c['expectedAnswer'].encode()) <= 128, 'invalid expected answer')
    return p, raw

def render(p, case):
    return (p['chat']['prefix'] + case['prompt'] + p['chat']['suffix']).encode('utf-8')

def model_pin(p):
    catalog, _ = read_json(ROOT / 'scripts/local-gguf/pins.json')
    matching = [x for x in catalog['models'] if x['id'] == p['model']['id']]
    require(len(matching) == 1, 'candidate must have one catalog pin')
    pin = matching[0]
    for key in ('id','filename','sha256','bytes'):
        require(pin[key] == p['model'][key], 'catalog/profile disagreement: ' + key)
    return pin

def verify_model(path, p):
    digest = hashlib.sha256()
    count = 0
    with Path(path).open('rb') as f:
        require(os.fstat(f.fileno()).st_size == p['model']['bytes'], 'model byte count mismatch')
        while chunk := f.read(1024 * 1024):
            count += len(chunk)
            require(count <= p['model']['bytes'], 'model grew while hashing')
            digest.update(chunk)
    require(count == p['model']['bytes'] and digest.hexdigest() == p['model']['sha256'], 'model SHA-256 mismatch')
    return {'sha256':digest.hexdigest(), 'bytes':count}

def prepare(p, raw, model, output):
    output = Path(output)
    require(not output.exists(), 'preparation destination already exists; preserve earlier evidence')
    output.mkdir(parents=True)
    pin = model_pin(p)
    store(output / 'model-pin.json', pin)
    (output / 'profile.json').write_bytes(raw)
    (output / 'runtime-pin.json').write_bytes((ROOT / 'runtime/ios/pin/llama-cpp.json').read_bytes())
    metadata = inspect_model(Path(model), output / 'model-pin.json')
    store(output / 'metadata.json', metadata)
    require(metadata['chatTemplate']['sha256'] == p['metadata']['templateSHA256'], 'embedded template differs from profile')
    require(metadata['chatTemplate']['utf8ByteLength'] == p['metadata']['templateBytes'], 'template length mismatch')
    tm = metadata['tokenizerMetadata']
    for key, expected in [('tokenizer.ggml.model','gpt2'),('tokenizer.ggml.pre','deepseek-r1-qwen'),
                          ('tokenizer.ggml.add_bos_token',True),('tokenizer.ggml.add_eos_token',False)]:
        require(tm.get(key) == expected, 'tokenizer metadata mismatch: ' + key)
    require(metadata['vocabulary']['count'] == 151936, 'wrong vocabulary size')
    for key, expected in [('bos',151646),('eos',151643)]:
        require(metadata['specialTokens']['tokenizer.ggml.' + key + '_token_id']['id'] == expected, 'wrong special token')
    prompts = output / 'prompts'
    prompts.mkdir()
    records = []
    for ordinal, case in enumerate(p['cases'], 1):
        rendered = render(p, case)
        (prompts / f'{ordinal:03d}.txt').write_bytes(rendered)
        records.append({'ordinal':ordinal, 'caseID':case['id'], 'promptSHA256':sha(rendered), 'promptBytes':len(rendered)})
    store(output / 'prepared.json', {'schemaVersion':1, 'profileSHA256':sha(raw), 'profileBytes':len(raw),
          'model':metadata['verifiedModel'], 'cases':records, 'inferencePerformed':False})

def verify_tokenizer(p, raw, records):
    require(len(records) == 10, 'expected vocabulary, eight prompt records and summary')
    vocab = records[0]
    require(vocab['recordType'] == 'vocabulary' and vocab['pinTag'] == 'b12233' and vocab['pinCommit'] == PIN_COMMIT,
            'tokenizer runtime identity mismatch')
    for key in ('inferencePerformed','contextCreated'):
        require(vocab[key] is False, 'vocabulary preflight cannot claim inference')
    require(vocab['vocabularySize'] == 151936 and vocab['addBOS'] is True and vocab['addEOS'] is False,
            'effective tokenizer flags mismatch')
    require(vocab['bosTokenId'] == 151646 and vocab['eosTokenId'] == 151643, 'effective special IDs mismatch')
    template = bytes.fromhex(vocab['templateUTF8Hex'])
    require(sha(template) == p['metadata']['templateSHA256'] and len(template) == p['metadata']['templateBytes'],
            'runtime template differs from artifact contract')
    spellings = {151646:BOS, 151643:'<｜end▁of▁sentence｜>', 151644:'<｜User｜>',
                 151645:'<｜Assistant｜>',151648:'<think>',151649:'</think>'}
    require(len(vocab['markers']) == 6 and {x['id'] for x in vocab['markers']} == set(spellings), 'marker set mismatch')
    for item in vocab['markers']:
        token = item['id']
        require(bytes.fromhex(item['spellingUTF8Hex']).decode() == spellings[token], 'marker spelling mismatch')
        require(item['isolatedTokenIDs'] == [token], 'marker is not recognized as one special-aware token')
        piece = bytes.fromhex(item['pieceSpecialFalseUTF8Hex']).decode()
        require(piece == (spellings[token] if token in (151648,151649) else ''), 'native piece visibility differs')
        require(item['isEOG'] is (token == 151643), 'unexpected end-of-generation marker')
    observations = []
    for ordinal, (case, item) in enumerate(zip(p['cases'], records[1:-1]), 1):
        require(item['recordType'] == 'prompt' and item['ordinal'] == ordinal, 'prompt order changed')
        expected = render(p, case)
        require(bytes.fromhex(item['promptUTF8Hex']) == expected, 'tokenized prompt differs')
        require(item['addSpecial'] is True and item['parseSpecial'] is True, 'native tokenizer flags changed')
        tokens = item['tokenIDs']
        require(isinstance(tokens, list) and 2 <= len(tokens) <= 2048 - 512, 'prompt leaves insufficient bounded context')
        require(all(type(t) is int and 0 <= t < 151936 for t in tokens), 'invalid token IDs')
        require(tokens[:2] == [151646,151644] and tokens.count(151646) == 1 and tokens.count(151644) == 1,
                'BOS/user duplication or wrong framing')
        require(tokens.count(151645) == 1 and tokens.count(151648) == 1 and 151643 not in tokens and 151649 not in tokens,
                'assistant/thinking/EOS marker mismatch')
        require(tokens.index(151645) + 1 == tokens.index(151648), 'thinking prefix misplaced')
        require(bytes.fromhex(item['detokenizedUTF8Hex']) == BOS.encode() + expected, 'exact token round trip failed')
        observations.append({'ordinal':ordinal,'caseID':case['id'],'promptSHA256':sha(expected), 'inputTokenCount':len(tokens),'tokenIDs':tokens})
    require(records[-1] == {'recordType':'summary','status':'completed','cases':8,'inferencePerformed':False}, 'incomplete tokenizer run')
    return {'schemaVersion':1,'integrityPass':True,'profileSHA256':sha(raw), 'cases':observations,
            'inferencePerformed':False,'instrumentedProductionInvocation':False}

def final_answer(output):
    if not isinstance(output, str) or len(output.encode('utf-8')) > 16384 or output.count('</think>') != 1 or '<think>' in output:
        return None
    suffix = output.split('</think>', 1)[1].strip(' \r\n\t')
    try:
        obj = decode(suffix)
    except (ValueError, RecursionError):
        return None
    if not isinstance(obj, dict) or set(obj) != {'answer'} or not isinstance(obj['answer'], str):
        return None
    try:
        obj['answer'].encode('utf-8', errors='strict')
    except UnicodeEncodeError:
        return None
    return obj['answer']

def nonnegative(value):
    return type(value) in (int,float) and math.isfinite(value) and value >= 0

def validate_measurement(p, raw, start, trials, summary, tokenization):
    profile_hash = sha(raw)
    require(tokenization.get('integrityPass') is True and tokenization.get('profileSHA256') == profile_hash, 'missing profile-bound tokenizer acceptance')
    require(start['schemaVersion'] == 1 and start['profileID'] == p['id'] and start['profileSHA256'] == profile_hash and start['profileBytes'] == len(raw), 'start profile mismatch')
    require(start['modelArtifactSHA256'] == DIGEST and start['modelBytes'] == MODEL_BYTES and start['modelID'] == 'sha256-' + DIGEST, 'start model identity mismatch')
    require(start['providerKind'] == 'llamaCpp' and start['llamaCppPinTag'] == 'b12233' and start['llamaCppPinCommit'] == PIN_COMMIT, 'not the pinned native provider')
    for key, expected in p['settings'].items():
        require(start[key] == expected, 'start setting mismatch: ' + key)
    require(start['offload']['requestedGpuLayers'] == 0 and start['offload']['offloadedLayers'] == 0, 'expected declared hosted CPU run')
    require(start['offload']['reportedLayerCount'] > 0, 'no reported model layers')
    for item in (start, summary):
        require(item['processPeakRSSMethod'] == METHOD and item['processPeakRSSScope'] == SCOPE, 'mislabelled process memory')
        require(nonnegative(item['processPeakRSSBytes']) and item['processPeakRSSBytes'] > 0, 'missing measured process RSS')
        require(nonnegative(item['loadLatencyMilliseconds']), 'invalid load timing')
    require(len(trials) == 8 and summary['trials'] == trials, 'missing, duplicate or altered trials')
    request_ids = set()
    last_rss = start['processPeakRSSBytes']
    budget_seen = False
    valid_count = correct_count = completed_count = 0
    for ordinal, (case, row) in enumerate(zip(p['cases'], trials), 1):
        require(row['ordinal'] == ordinal and row['caseID'] == case['id'], 'case identity/order changed')
        require(row['profileSHA256'] == profile_hash and row['modelArtifactSHA256'] == DIGEST, 'trial artifact identity mismatch')
        require(row['promptSHA256'] == sha(render(p,case)), 'actual native prompt hash mismatch')
        require(row['expectedAnswer'] == case['expectedAnswer'], 'answer key changed')
        require(row['status'] in ('completed','partial','failed','notRunBudget'), 'unknown result status')
        require(not budget_seen or row['status'] == 'notRunBudget', 'requests resumed after the run budget expired')
        if row['status'] == 'notRunBudget':
            budget_seen = True
            require(row['rawOutput'] is None and row['parsedAnswer'] is None and row['validFinalJSON'] is False
                    and row['scoredCorrect'] is False and row['latencyMilliseconds'] == 0, 'unattempted case contains generation data')
        require(row['requestID'] is None if row['status'] == 'notRunBudget' else isinstance(row['requestID'],str) and row['requestID'] not in request_ids,
                'missing or reused request identity')
        if row['requestID'] is not None:
            request_ids.add(row['requestID'])
        require(nonnegative(row['latencyMilliseconds']), 'invalid trial timing')
        for key in ('finishReason','tokenCount','timeToFirstTokenMilliseconds'):
            require(key in row and row[key] is None and start[key] is None, 'unavailable generation telemetry was invented')
        if row['status'] != 'notRunBudget':
            require(nonnegative(row['processPeakRSSBytes']) and row['processPeakRSSBytes'] > 0, 'missing process RSS observation')
        if row['processPeakRSSBytes'] is not None:
            require(nonnegative(row['processPeakRSSBytes']) and row['processPeakRSSBytes'] >= last_rss, 'process high-water RSS decreased')
            last_rss = row['processPeakRSSBytes']
        require(row['rawOutput'] is None or (isinstance(row['rawOutput'], str) and len(row['rawOutput'].encode()) <= 16384), 'unbounded output')
        parsed = final_answer(row['rawOutput'])
        valid = parsed is not None
        correct = valid and row['status'] == 'completed' and parsed == case['expectedAnswer']
        require(row['parsedAnswer'] == parsed and row['validFinalJSON'] is valid and row['scoredCorrect'] is correct, 'native scoring disagrees with independent parser')
        if row['status'] == 'completed':
            require(row['errorMessage'] is None, 'completed result has an error')
            completed_count += 1
        else:
            require(isinstance(row['errorMessage'],str) and bool(row['errorMessage']), 'failed/budget result lacks an explanation')
        valid_count += valid
        correct_count += correct
    require(summary['schemaVersion'] == 1 and summary['profileSHA256'] == profile_hash, 'summary profile mismatch')
    require(summary['status'] in ('completed','budgetExceeded'), 'invalid run status')
    require(nonnegative(summary['elapsedMilliseconds']), 'invalid run timing')
    expired = summary['elapsedMilliseconds'] >= p['settings']['maximumDurationSeconds'] * 1000
    require(not budget_seen or expired, 'budget was reported before the declared duration')
    require(summary['status'] == ('budgetExceeded' if expired else 'completed'), 'run status disagrees with attempted rows and duration')
    require(summary['modelArtifactSHA256After'] == DIGEST and summary['modelBytesAfter'] == MODEL_BYTES, 'model changed during generation')
    require(nonnegative(summary['elapsedMilliseconds']) and nonnegative(summary['totalLatencyMilliseconds']), 'invalid total timing')
    require(summary['loadLatencyMilliseconds'] == start['loadLatencyMilliseconds'], 'load timing changed')
    require(sum(t['latencyMilliseconds'] for t in trials) <= summary['elapsedMilliseconds'] + 1, 'trial durations exceed the run duration')
    require(summary['elapsedMilliseconds'] + start['loadLatencyMilliseconds'] <= summary['totalLatencyMilliseconds'] + 1, 'load and run durations exceed the total')
    require(summary['processPeakRSSBytes'] >= last_rss, 'final process high-water RSS decreased')
    c = summary['cleanup']
    require(c['leaseReleased'] is True and c['activeLeaseCountBeforeRelease'] == 1, 'runtime lease not released')
    for key in ('activeUseCountBeforeRelease','activeRequestsBeforeRelease','waitingRequestsBeforeRelease','activeLeaseCount',
                'activeUseCount','reservedMemoryMB','activeRequests','waitingRequests'):
        require(c[key] == 0, 'runtime cleanup failed: ' + key)
    for key in ('loadedModelIDs','pendingModelIDs','unloadingModelIDs'):
        require(c[key] == [], 'runtime model remains resident: ' + key)
    quality = correct_count == 8 and valid_count == 8 and completed_count == 8 and summary['status']=='completed'
    return {'schemaVersion':1,'profileSHA256':profile_hash,'modelArtifactSHA256':DIGEST,'integrityPass':True,
            'qualityPass':quality,'caseCount':8,'completedCount':completed_count,'validFinalCount':valid_count,
            'correctCount':correct_count,'invalidOrIncorrectCount':8-correct_count,'trials':trials,
            'loadLatencyMilliseconds':start['loadLatencyMilliseconds'],'elapsedMilliseconds':summary['elapsedMilliseconds'],
            'processPeakRSSBytes':summary['processPeakRSSBytes'],'processPeakRSSMethod':METHOD,'processPeakRSSScope':SCOPE,
            'finishReason':None,'tokenCount':None,'timeToFirstTokenMilliseconds':None,
            'hardwareAcceptance':False,'modelPromotion':False,'authorized':False,'apexReceipt':False}

def records_from_log(path):
    with Path(path).open('rb') as f:
        raw = f.read(32_000_001)
    require(len(raw) <= 32_000_000, 'native log exceeds bound')
    found = {'START':[],'TRIAL':[],'SUMMARY':[]}
    for line in raw.decode('utf-8', errors='strict').splitlines():
        for kind in found:
            marker = 'POCKET_DEEPSEEK_' + kind + ' '
            if line.startswith(marker):
                found[kind].append(decode(line[len(marker):]))
    require(len(found['START']) == 1 and len(found['SUMMARY']) == 1, 'missing or duplicated start/summary')
    return found['START'][0], found['TRIAL'], found['SUMMARY'][0]

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('command',choices=('prepare','verify-model','tokenizer','verify','gate'))
    ap.add_argument('--profile',type=Path,default=PROFILE)
    ap.add_argument('--model',type=Path)
    ap.add_argument('--output',type=Path)
    ap.add_argument('--input',type=Path)
    ap.add_argument('--tokenizer',type=Path)
    args = ap.parse_args()
    audit = None
    try:
        p, raw = profile_at(args.profile)
        if args.command == 'prepare':
            require(args.model is not None and args.output is not None, 'prepare needs model and output')
            prepare(p,raw,args.model,args.output)
        elif args.command == 'verify-model':
            require(args.model is not None, 'verify-model needs model')
            print(json.dumps(verify_model(args.model,p)))
        elif args.command == 'tokenizer':
            require(args.input is not None and args.output is not None, 'tokenizer needs input and output')
            require(args.input.stat().st_size <= 2_000_000, 'tokenizer log exceeds bound')
            records = [decode(line) for line in args.input.read_text().splitlines() if line.strip()]
            store(args.output,verify_tokenizer(p,raw,records))
        elif args.command == 'verify':
            require(args.input is not None and args.tokenizer is not None and args.output is not None, 'verify needs input, tokenizer and output')
            tokenizer,_ = read_json(args.tokenizer)
            start,trials,summary = records_from_log(args.input)
            audit = validate_measurement(p,raw,start,trials,summary,tokenizer)
            store(args.output,audit)
        else:
            require(args.input is not None, 'gate needs audit input')
            audit,_ = read_json(args.input)
            require(audit.get('profileSHA256') == sha(raw) and audit.get('integrityPass') is True and audit.get('qualityPass') is True
                    and audit.get('correctCount') == 8 and audit.get('validFinalCount') == 8 and audit.get('completedCount') == 8,
                    'development quality gate failed: all eight complete final answers must be correct')
        print('DeepSeek qualification ' + args.command + ' completed.')
        return 0
    except (OSError,ValueError,KeyError,TypeError) as error:
        if args.command == 'verify' and args.output is not None:
            store(args.output,{'schemaVersion':1,'integrityPass':False,'qualityPass':False,'error':str(error),
                              'hardwareAcceptance':False,'modelPromotion':False,'authorized':False})
        print('DeepSeek qualification failed: ' + str(error),file=sys.stderr)
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
