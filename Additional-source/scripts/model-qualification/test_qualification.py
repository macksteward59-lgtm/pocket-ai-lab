import copy
import json
from pathlib import Path
import tempfile
import unittest
import qualification as q


def fixture():
    p, raw = q.profile_at()
    digest = q.sha(raw)
    start = {'schemaVersion':1,'profileID':p['id'],'profileSHA256':digest,'profileBytes':len(raw),
        'modelID':'sha256-'+q.DIGEST,'modelArtifactSHA256':q.DIGEST,'modelBytes':q.MODEL_BYTES,
        'providerKind':'llamaCpp','llamaCppPinTag':'b12233','llamaCppPinCommit':q.PIN_COMMIT,
        **p['settings'],'offload':{'requestedGpuLayers':0,'offloadedLayers':0,'reportedLayerCount':29},
        'loadLatencyMilliseconds':100,'processPeakRSSBytes':1000000,'processPeakRSSMethod':q.METHOD,
        'processPeakRSSScope':q.SCOPE,'finishReason':None,'tokenCount':None,'timeToFirstTokenMilliseconds':None}
    rows=[]
    for n,c in enumerate(p['cases'],1):
        rows.append({'ordinal':n,'caseID':c['id'],'requestID':'request-'+str(n),'profileSHA256':digest,
            'modelArtifactSHA256':q.DIGEST,'promptSHA256':q.sha(q.render(p,c)),'expectedAnswer':c['expectedAnswer'],
            'status':'completed','rawOutput':'Check the supplied fact.\n</think>\n'+json.dumps({'answer':c['expectedAnswer']}),
            'parsedAnswer':c['expectedAnswer'],'validFinalJSON':True,'scoredCorrect':True,'errorMessage':None,
            'latencyMilliseconds':200,'processPeakRSSBytes':1000000,'finishReason':None,'tokenCount':None,'timeToFirstTokenMilliseconds':None})
    cleanup={'leaseReleased':True,'activeLeaseCountBeforeRelease':1,'activeUseCountBeforeRelease':0,
        'activeRequestsBeforeRelease':0,'waitingRequestsBeforeRelease':0,'activeLeaseCount':0,'activeUseCount':0,
        'reservedMemoryMB':0,'activeRequests':0,'waitingRequests':0,'loadedModelIDs':[], 'pendingModelIDs':[], 'unloadingModelIDs':[]}
    summary={'schemaVersion':1,'profileSHA256':digest,'status':'completed','loadLatencyMilliseconds':100,
        'elapsedMilliseconds':1600,'totalLatencyMilliseconds':1700,'modelArtifactSHA256After':q.DIGEST,
        'modelBytesAfter':q.MODEL_BYTES,'processPeakRSSBytes':1000000,'processPeakRSSMethod':q.METHOD,
        'processPeakRSSScope':q.SCOPE,'trials':rows,'cleanup':cleanup}
    tokenization={'integrityPass':True,'profileSHA256':digest}
    return p,raw,start,rows,summary,tokenization

class QualificationAuditTests(unittest.TestCase):
    def test_complete_measurement_and_quality_are_distinct(self):
        args=fixture()
        self.assertTrue(q.validate_measurement(*args)['qualityPass'])
        row=args[3][0]
        row.update(rawOutput='Reason\n</think>\n{"answer":"WRONG"}',parsedAnswer='WRONG',scoredCorrect=False)
        audit=q.validate_measurement(*args)
        self.assertTrue(audit['integrityPass'])
        self.assertFalse(audit['qualityPass'])
        self.assertEqual(audit['correctCount'],7)

    def test_reasoning_json_cannot_be_scored_as_final(self):
        self.assertIsNone(q.final_answer('{"answer":"RIGHT"} but unfinished reasoning'))
        self.assertEqual(q.final_answer('{"answer":"RIGHT"}\n</think>\n{"answer":"WRONG"}'),'WRONG')

    def test_exact_suffix_and_unique_keys_are_required(self):
        bad=['</think>{"answer":"A","answer":"A"}', '</think>{"answer":"A","other":1}',
             '</think>{"answer":"A"} trailing', '</think>```json\n{"answer":"A"}\n```',
             '</think>{"answer":"A"}</think>', '<think>x</think>{"answer":"A"}',
             '</think>{"answer":null}', '</think>[{"answer":"A"}]', '</think>{"answer":NaN}']
        for text in bad:
            with self.subTest(text=text): self.assertIsNone(q.final_answer(text))
        self.assertEqual(q.final_answer('x</think> {"answer":"A\\nB"}\n'),'A\nB')

    def test_partial_correct_suffix_stays_failed(self):
        args=fixture()
        args[3][0].update(status='partial',errorMessage='interrupted',scoredCorrect=False)
        audit=q.validate_measurement(*args)
        self.assertFalse(audit['qualityPass'])
        self.assertEqual(audit['validFinalCount'],8)
        self.assertEqual(audit['correctCount'],7)

    def test_fabricated_native_scores_are_rejected(self):
        args=fixture()
        args[3][0]['rawOutput']='Reason</think>{"answer":"WRONG"}'
        with self.assertRaisesRegex(q.QualificationError,'scoring'): q.validate_measurement(*args)

    def test_missing_duplicate_and_reordered_rows_are_rejected(self):
        for mode in ('missing','duplicate','reordered'):
            args=fixture()
            if mode=='missing': args[3].pop()
            if mode=='duplicate': args[3][1]=copy.deepcopy(args[3][0])
            if mode=='reordered': args[3][0],args[3][1]=args[3][1],args[3][0]
            with self.subTest(mode=mode),self.assertRaises(q.QualificationError):q.validate_measurement(*args)

    def test_model_and_prompt_mutation_are_rejected(self):
        for field in ('promptSHA256','modelArtifactSHA256','profileSHA256'):
            args=fixture();args[3][0][field]='0'*64
            with self.subTest(field=field),self.assertRaises(q.QualificationError):q.validate_measurement(*args)
        args=fixture();args[4]['modelArtifactSHA256After']='0'*64
        with self.assertRaises(q.QualificationError):q.validate_measurement(*args)

    def test_unavailable_telemetry_is_not_inferred(self):
        for field in ('finishReason','tokenCount','timeToFirstTokenMilliseconds'):
            args=fixture();args[3][0][field]=1
            with self.subTest(field=field),self.assertRaises(q.QualificationError):q.validate_measurement(*args)

    def test_estimated_memory_cannot_be_called_measured_rss(self):
        args=fixture();args[4]['processPeakRSSMethod']='poolReservationEstimate'
        with self.assertRaises(q.QualificationError):q.validate_measurement(*args)

    def test_cleanup_failure_rejects_measurement(self):
        args=fixture();args[4]['cleanup']['loadedModelIDs']=['resident']
        with self.assertRaises(q.QualificationError):q.validate_measurement(*args)

    def test_budget_preserves_fixed_denominator(self):
        args=fixture();row=args[3][-1]
        row.update(status='notRunBudget',rawOutput=None,parsedAnswer=None,requestID=None,
                   validFinalJSON=False,scoredCorrect=False,errorMessage='run budget exhausted',processPeakRSSBytes=None,latencyMilliseconds=0)
        args[4].update(status='budgetExceeded',elapsedMilliseconds=900000,totalLatencyMilliseconds=900100)
        audit=q.validate_measurement(*args)
        self.assertTrue(audit['integrityPass'])
        self.assertEqual(audit['caseCount'],8)
        self.assertEqual(audit['correctCount'],7)
        self.assertFalse(audit['qualityPass'])

    def test_duplicate_summary_and_record_markers_in_output(self):
        p,raw,start,rows,summary,tok=fixture()
        rows[0]['rawOutput']='POCKET_DEEPSEEK_START {"spoof":true}'
        lines=['POCKET_DEEPSEEK_START '+json.dumps(start)]
        lines += ['POCKET_DEEPSEEK_TRIAL '+json.dumps(x) for x in rows]
        lines += ['POCKET_DEEPSEEK_SUMMARY '+json.dumps(summary)]
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/'run.log';f.write_text('\n'.join(lines))
            self.assertEqual(len(q.records_from_log(f)[1]),8)
            f.write_text('\n'.join(lines+[lines[-1]]))
            with self.assertRaises(q.QualificationError):q.records_from_log(f)


    def test_high_water_memory_and_timings_cannot_go_backwards(self):
        for changes in ({'processPeakRSSBytes':1},{'elapsedMilliseconds':1},{'totalLatencyMilliseconds':0}):
            args=fixture();args[4].update(changes)
            with self.subTest(changes=changes),self.assertRaises(q.QualificationError):q.validate_measurement(*args)
        args=fixture();args[3][3]['processPeakRSSBytes']=1
        with self.assertRaises(q.QualificationError):q.validate_measurement(*args)

    def test_budget_skips_cannot_contain_outputs_or_resume(self):
        args=fixture();args[3][0].update(status='notRunBudget',requestID=None,scoredCorrect=False,errorMessage='budget')
        args[4].update(status='budgetExceeded',elapsedMilliseconds=900000,totalLatencyMilliseconds=900100)
        with self.assertRaises(q.QualificationError):q.validate_measurement(*args)
        args[3][0].update(rawOutput=None,parsedAnswer=None,validFinalJSON=False,latencyMilliseconds=0)
        with self.assertRaisesRegex(q.QualificationError,'resumed'):q.validate_measurement(*args)

    def test_deadline_crossing_in_last_attempt_is_a_quality_failure(self):
        args=fixture();args[4].update(status='budgetExceeded',elapsedMilliseconds=901000,totalLatencyMilliseconds=901100)
        audit=q.validate_measurement(*args)
        self.assertTrue(audit['integrityPass']);self.assertFalse(audit['qualityPass'])
        args[4]['status']='completed'
        with self.assertRaises(q.QualificationError):q.validate_measurement(*args)

    def test_unpaired_unicode_surrogates_are_rejected(self):
        self.assertIsNone(q.final_answer('x</think>{"answer":"\\ud800"}'))
        self.assertIsNone(q.final_answer('x</think>{"answer":"\\udc00"}'))
        self.assertEqual(q.final_answer('x</think>{"answer":"\\ud83d\\ude00"}'),'😀')

if __name__=='__main__':unittest.main()
